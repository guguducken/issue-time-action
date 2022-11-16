const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

//get variables
const uri_warn = core.getInput('uri_warn', { required: true });
const token = core.getInput('token_action', { required: true });
const str_repos = core.getInput('repos', { required: true });
const warn_time = core.getInput('warning_time', { required: true });
const label_check = core.getInput('label_check', { required: true });
const label_skip = core.getInput('label_skip', { required: false });
const milestones = core.getInput('milestones', { required: false });
const type_message = core.getInput('type', { required: false });
const mentions_l = core.getInput('mentions', { required: false });
const cor = JSON.parse(core.getInput('corresponding', { required: true }));



// const repo = github.context.repo
let repos = new Array();

class repo_t {
    constructor(owner, repo, fullname) {
        this.repo = repo;
        this.owner = owner;
        this.fullname = fullname;
    }
}


//get oc client
const oc = github.getOctokit(token);
const arr_label_skip = label_skip.split(",");
const arr_label_check = label_check.split(",");
const arr_warn_time = warn_time.split(" ");
const arr_mention = mentions_l.split(",");
const arr_milestone = milestones.split(" ");

//get the timestamp of now
const t_rf = new Date();
const t_now = t_rf.getTime();
const day_one = 86400000; //ms
let t_warn = parseMillSecond(parseArray(arr_warn_time));

function parseMillSecond(arr) {
    let t = new Array();
    for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        t.push(e * 3600000);
    }
    return t;
}

function parseArray(arr) {
    ans = new Array();
    for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        ans.push(parseInt(e));
    }
    return ans;
}

function checkFirst() {
    if (arr_warn_time.length == 0 || arr_label_check.length == 0 || arr_warn_time.length != arr_label_check.length) {
        throw new Error("The time of warning or the name of label is invalid. Please check your Input")
    }
    if (uri_warn.length == 0) {
        throw new Error("The Webhook of error notice(uri_error) is invalid");
    }
    let t = str_repos.split(",");
    for (let i = 0; i < t.length; i++) {
        const e = t[i].split("/");
        let repo = new repo_t(e[0], e[1], t[i]);
        repos.push(repo);
    }
    core.info("First check pass....");
}
//全局变量，方便整合消息
let mess_warn = {};
let mention_message = "";


async function run(repo) {
    try {
        let num_warn = 0;
        let num_sum = 0;

        mention_message += "---> " + repo.fullname + " <---\n"

        let num_warn_split = new Array(t_warn.length);
        for (let i = 0; i < arr_label_check.length; i++) {
            num_warn_split[i] = 0;
        }
        for (let k = 0; k < arr_label_check.length; k++) {
            let per_page = 100;
            let now = 1;

            while (true) {
                let issues = await getIssues(now, per_page, arr_label_check[k], repo);
                if (issues === undefined) {
                    core.info(">>>>>>>>>>>>>>>>>>>>>>>>>>>> Job finish <<<<<<<<<<<<<<<<<<<<<<<<<<<<");
                    break;
                }
                now++;
                for (let i = 0; i < issues.length; i++) {
                    const e = issues[i];
                    if (e.pull_request !== undefined || skipLabel(e) || !checkMilestone(e) || !cor.hasOwnProperty(e.assignee.login)) { //跳过后续的检查和发送通知
                        continue;
                    }
                    num_sum++;

                    //检查更新时间
                    core.info("issue number: " + e.number);
                    let time_update = await getLastPRCommitUpdateTime(e, repo);
                    if (time_update === null) {
                        time_update = {
                            updatedAt: e.created_at,
                        }
                    }
                    let check_update = await TimeCheck(time_update.updatedAt, k);
                    if (!check_update.check_ans) {
                        let m = await getMessage("warning", issues[i], check_update);
                        if (mess_warn[e.assignee.login] === undefined) {
                            //初始化对象，设置login和对应的不同label的初始message
                            mess_warn[e.assignee.login] = userInit(e.assignee.login)
                        }
                        mess_warn[e.assignee.login]["messages"][repo.fullname][arr_label_check[k]]["body"] += m;
                        mess_warn[e.assignee.login]["messages"][repo.fullname][arr_label_check[k]]["num"]++;
                        mess_warn[e.assignee.login]["messages"][repo.fullname]["total"]++;


                        //统计每一个label对应的issue的个数
                        num_warn_split[k]++;
                        //统计总的warning的数量
                        num_warn++;
                        core.info(">>> " + repo.fullname + " Warning " + num_warn + " issue: " + e.number + " - " + e.title + " update time: " + time_update.updatedAt);
                    }
                }
            }
            mention_message += arr_label_check[k] + " total: " + num_warn_split[k] + "\n";
        }
        core.info(repo.fullname + " total warning: " + num_warn);
        core.info(repo.fullname + " total issues: " + num_sum);

    } catch (err) {
        core.setFailed(err.message);
    }
}

function assignAndTotal(message, total, assign) {
    message += `-------------------------------------\nTotal: ${total}\nAssignee: <@${assign}>`;
    return message
}

//init user object
function userInit(login) {
    let u = {
        weCom: cor[login],
        messages: {}
    };
    for (let i = 0; i < repos.length; i++) {
        const repo = repos[i];
        u["messages"][repo.fullname] = {
            total: 0
        };
        for (let j = 0; j < arr_label_check.length; j++) {
            const l = arr_label_check[j];
            u["messages"][repo.fullname][l] = {
                body: "----- **<font color=\"warning\">" + arr_label_check[j] + "</font>** -----\n",
                num: 0
            }
        }
    }
    return u;
}

//get issues by issue
async function getIssues(now, num_page, label, repo) {
    const { data: iss } = await oc.rest.issues.listForRepo(
        {
            ...repo,
            state: "open",
            sort: "created",
            direction: "asc",
            labels: label,
            per_page: num_page,
            page: now
        }
    );
    if (iss.length == 0) {
        return undefined;
    }
    return iss;
}

function checkMilestone(issue) {
    if (milestones.length == 0) {
        return true
    }
    if (issue.milestone === null) {
        return true
    }
    for (let i = 0; i < arr_milestone.length; i++) {
        const m = arr_milestone[i];
        if (issue.milestone.title == m) {
            return true
        }
    }
    return false
}

async function getMessage(type, issue, check) {
    let message = "";

    switch (type) {
        case "warning":
            message = `-------------------------------------\n[${issue.title}](${issue.html_url})\nUpdateAt: ${check.in}\nWorked: ${check.pass.work.pass}\n`;
            break;
        case "error":
            message = `-------------------------------------\n[${issue.title}](${issue.html_url})\nUpdateAt: ${check.in}\nWorked: ${check.pass.work.pass}\n`;
            break;
        default:
            break;
    }
    return message;
}

async function sendWeComMessage(uri, type, message, mentions) {
    let payload = {
        msgtype: type,
    };
    switch (type) {
        case "text":
            payload.text = {
                content: message,
                mentioned_list: mentions
            };
            core.info(JSON.stringify(payload));
            break;
        case "markdown":
            payload.markdown = {
                content: message
            };
            break;
        default:
            break;
    }
    try {
        axios.post(uri, JSON.stringify(payload), {
            Headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (err) {
        core.info(err.message);
    }
}

//the format of t is object Date
async function TimeCheck(ti, ind) {
    let t_in = Date.parse(ti);
    if (t_in >= t_now) {
        return { in: ti, check_ans: true, pass: undefined }
    }

    let { work, holiday } = getDays(new Date(ti), t_rf);

    core.info(`Pass: work--> ${work.pass} == ${work.mile_total}ms || holiday--> ${holiday.pass} == ${holiday.mile_total}ms`);
    if (work.mile_total > t_warn[ind]) {
        return { in: ti, check_ans: false, pass: { work, holiday } }
    }

    return { in: ti, check_ans: true, pass: { work, holiday } }
}

class time_pass {
    constructor(days, hours, minutes, seconds, milliseconds, mile_total, pass) {
        this.days = days;
        this.hours = hours;
        this.minutes = minutes;
        this.seconds = seconds;
        this.milliseconds = milliseconds;
        this.mile_total = mile_total;
        this.pass = pass;
    }
}

function getPass(duration) {
    let t = duration;
    let milliseconds = duration % 1000;
    duration = parseInt(duration / 1000);
    let seconds = duration % 60;
    duration = parseInt(duration / 60);
    let minutes = duration % 60;
    duration = parseInt(duration / 60);
    let hours = duration % 24;
    duration = parseInt(duration / 24);
    let days = duration;
    return new time_pass(days, hours, minutes, seconds, milliseconds, t, `${days}d-${hours}h:${minutes}m:${seconds}s`);
}

function getDays(start, end) {
    let t_1 = getPass(Date.parse(end) - Date.parse(start));
    let mil_start = start.getTime();
    let mil_end = end.getTime();

    let holiday = 0;
    let work = 0;

    let weeks = parseInt(t_1.days / 7);
    if (weeks >= 1) {
        holiday += weeks * 2 * day_one;
        work += weeks * 5 * day_one;
    }
    let day_start = start.getDay();
    day_start = day_start == 0 ? 7 : day_start;
    let day_end = end.getDay();
    day_end = day_end == 0 ? 7 : day_end;

    let dura_start_one = (day_start - 1) * day_one + (mil_start - (new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0).getTime()))
    let dura_end_one = (day_end - 1) * day_one + (mil_end - (new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0).getTime()))
    if (dura_end_one > dura_start_one) {
        if (day_end >= 6) {
            if (day_start >= 6) {
                holiday += dura_end_one - dura_start_one;
            } else {
                let dura_end_six = (day_end - 6) * day_one + (mil_end - (new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0).getTime()))
                holiday += dura_end_six;
                work += 5 * day_one - dura_start_one;
            }
        } else {
            work += dura_end_one - dura_start_one;
        }
    } else {
        let work_start = 5 * day_one - dura_start_one;
        if (work_start >= 0) {
            work += work_start;
            dura_start_one = 5 * day_one;
        }
        let holid_start = 7 * day_one - dura_start_one;
        holiday += holid_start;

        let holid_end = dura_end_one - 6 * day_one;
        if (holid_end >= 0) {
            holiday += holid_end;
            dura_end_one = 6 * day_one;
        }
        work += dura_end_one;
    }
    return { work: getPass(work), holiday: getPass(holiday) }
}

function skipLabel(issue) {
    if (label_skip.length == 0) {
        return false
    }
    for (let i = 0; i < issue.labels.length; i++) {
        const label = issue.labels[i].name;
        for (let j = 0; j < arr_label_skip.length; j++) {
            const e = arr_label_skip[j];
            if (label === e) {
                return true
            }
        }
    }
    return false

}

async function getLastPRCommitUpdateTime(issue, repo) {
    let query = `query ($repo: String!, $repo_owner: String!, $number_iss: Int!, $Last: Int, $Course: String) {
  repository(name: $repo, owner: $repo_owner) {
    issue(number: $number_iss) {
      id
      timelineItems(
        last: $Last
        before: $Course
      ) {
        updatedAt
        edges {
          node {
            ... on CrossReferencedEvent {
              source {
                ... on PullRequest {
                  id
                  updatedAt
                  createdAt
                }
              }
            }
            ... on IssueComment {
              id
              updatedAt
              createdAt
            }
          }
          cursor
        }
      }
    }
  }
}`;
    let per_page = 40;
    let course = null;
    let lastPRORCommit = null;
    let time_last = 0;
    let { repository } = await oc.graphql(query, {
        "repo": repo.repo,
        "repo_owner": repo.owner,
        "number_iss": issue.number,
        "Last": per_page,
    });
    let edges = repository.issue.timelineItems.edges;

    while (edges.length != 0) {
        course = edges[0].cursor;
        for (let i = edges.length - 1; i >= 0; i--) {
            const e = edges[i];
            if (e.node !== undefined && Object.keys(e.node).length != 0) {
                if (e.node.source !== undefined && Object.keys(e.node.source).length != 0) {
                    if (Date.parse(e.node.source.updatedAt) > time_last) {
                        lastPRORCommit = e.node.source
                        time_last = Date.parse(e.node.source.updatedAt)
                    }
                }
                if (e.node.updatedAt !== undefined) {
                    if (Date.parse(e.node.updatedAt) > time_last) {
                        lastPRORCommit = e.node
                        time_last = Date.parse(e.node.updatedAt)
                    }
                }
            }
        }
        data = await oc.graphql(query, {
            "repo": repo.repo,
            "repo_owner": repo.owner,
            "number_iss": issue.number,
            "Last": per_page,
            "Course": course
        });
        edges = data.repository.issue.timelineItems.edges;
    }

    return lastPRORCommit;
}

async function main() {
    //check input
    checkFirst();
    core.info(JSON.stringify(repos));

    for (let i = 0; i < repos.length; i++) {
        const repo = repos[i];
        await run(repo);
    }
    //send message which group by assignee
    for (const key in mess_warn) {
        let u = mess_warn[key];
        let m = "";
        let total = 0;
        let count = 0;
        for (const repo in u.messages) {
            if (u.messages[repo]["total"] == 0) {
                continue;
            }
            if (count != 0) {
                m += `********************\n`;
            }
            count++;
            m += `===== \`${repo}\` =====\n`;
            for (const label in u.messages[repo]) {
                if (u.messages[repo][label]["num"] > 0) {
                    m += u.messages[repo][label]["body"];
                    total += u.messages[repo][label]["num"];
                }
            }
        }
        m = assignAndTotal(m, total, u.weCom)
        sendWeComMessage(uri_warn, type_message, m);
    }
    sendWeComMessage(uri_warn, "text", mention_message, arr_mention);
}

main();