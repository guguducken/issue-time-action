const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

//get variables
const uri_warn = core.getInput('uri_warn', { required: true });
const token = core.getInput('token_action', { required: true });
const repo_name = core.getInput('repo_name', { required: true });
const repo_owner = core.getInput('repo_owner', { required: true });
const warn_time = core.getInput('warning_time', { required: true });
const label_check = core.getInput('label_check', { required: true });
const label_skip = core.getInput('label_skip', { required: false });
const type_message = core.getInput('type', { required: false });
const mentions_l = core.getInput('mentions', { required: false });
const cor = JSON.parse(core.getInput('corresponding', { required: true }));


// const repo = github.context.repo
const repo = {
    repo: repo_name,
    owner: repo_owner
}
const min = 10;


//get oc client
const oc = github.getOctokit(token);
const arr_label_skip = label_skip.split(",");
const arr_label_check = label_check.split(",");
const arr_warn_time = warn_time.split(" ");
const arr_mention = mentions_l.split(",");

//get the timestamp of now
const t_now = new Date().getTime();
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
    core.info("First check pass....");
}

async function main() {
    try {
        //check input
        checkFirst();

        let num_warn = 0;
        let num_sum = 0;

        //coding
        let mention_message = "";

        let mess_warn = {};
        let num_warn_split = new Array(t_warn.length);
        for (let i = 0; i < mess_warn.length; i++) {
            // mess_warn[i] = { message: "**<font color=\"warning\">" + arr_label_check[i] + " Status Update Wanted !!!</font>**\n", num: 0 };
            num_warn_split[i] = 0;
        }
        for (let k = 0; k < arr_label_check.length; k++) {
            let per_page = 100;
            let now = 1;

            while (true) {
                let issues = await getIssues(now, per_page, arr_label_check[k]);
                if (issues === undefined) {
                    core.info(">>>>>>>>>>>>>>>>>>>>>>>>>>>> Job finish <<<<<<<<<<<<<<<<<<<<<<<<<<<<");
                    break;
                }
                now++;
                for (let i = 0; i < issues.length; i++) {
                    const e = issues[i];
                    if (e.pull_request !== undefined || skipLabel(e)) { //跳过后续的检查和发送通知
                        continue;
                    }
                    num_sum++;

                    //检查更新时间
                    core.info("issue number: " + e.number);
                    let time_update = await getLastPRCommitUpdateTime(e);
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
                        mess_warn[e.assignee.login][messages][arr_label_check[k]] += m;
                        mess_warn[e.assignee.login][total]++;

                        //统计每一个label对应的issue的个数
                        num_warn_split[k]++;
                        //统计总的warning的数量
                        num_warn++;
                        core.info(">>> Warning " + num_warn + " issue: " + e.number + " - " + e.title + " update time: " + time_update.updatedAt);
                    }
                }
            }
            mention_message += arr_label_check[k] + " total: " + num_warn_split[k] + "\n";
        }
        //send message which group by assignee
        for (const key in mess_warn) {
            let u = mess_warn[key];
            let m = "";
            for (const key in u.messages) {
                m += u.messages[key];
            }
            sendWeComMessage(uri_warn, type_message, assignAndTotal(m, u.total, u.weCom));
        }
        sendWeComMessage(uri_warn, "text", mention_message, arr_mention);

        core.info("total warning: " + num_warn);
        core.info("total issues: " + num_sum);
    } catch (err) {
        core.setFailed(err.message);
    }
}

function assignAndTotal(message, total, assign) {
    message += `-------------------------------------\nTotal: ${total}\nAssignee: <@${assign}>`;
}

//init user object
function userInit(login) {
    let u = {
        weCom: cor[login],
        total: 0,
        messages: {}
    };
    for (let j = 0; j < arr_label_check.length; j++) {
        const l = arr_label_check[j];
        u[messages][l] = "**<font color=\"warning\">" + arr_label_check[j] + "</font>**\n";
    }
    return u;
}

//get issues by issue
async function getIssues(now, num_page, label) {
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

async function getMessage(type, issue, check) {
    let message = "";
    // let assig = "";
    // if (issue.assignees.length != 0) {
    //     for (let i = 0; i < issue.assignees.length; i++) {
    //         const u = issue.assignees[i];
    //         assig = "<" + cor[u.login] + ">" + "," + assig;
    //     }
    //     if (assig[assig.length - 1] == ',') {
    //         assig = assig.substring(0, assig.length - 1);
    //     }
    // }

    switch (type) {
        case "warning":
            message = `-------------------------------------\n[${issue.title}](${issue.html_url})\nUpdateAt: ${check.in}\nPassed: ${check.pass}\n`
            break;
        case "error":
            message = `-------------------------------------\n[${issue.title}](${issue.html_url})\nUpdateAt: ${check.in}\nPassed: ${check.pass}\n`
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

//the format of t is RFC3339 and Zulu time
async function TimeCheck(ti, ind) {
    let t_in = Date.parse(ti);
    if (t_in >= t_now) {
        return { in: ti, check_ans: true, pass: "0d-0h:0m:0s" }
    }
    let duration = t_now - t_in;
    let dura_t = t_now - t_in;
    let millisecond = duration % 1000;
    duration = parseInt(duration / 1000);

    let second = duration % 60;
    duration = parseInt(duration / 60);

    let minute = duration % 60;
    duration = parseInt(duration / 60);

    let hour = duration % 24;
    duration = parseInt(duration / 24);

    let day = duration;

    let pass = `${day}d-${hour}h:${minute}m:${second}s`

    core.info("in TimeCheck: " + ti + " >> " + pass + " >> dura_t: " + dura_t);
    if (dura_t > t_warn[ind]) {
        return { in: ti, check_ans: false, pass: pass }
    }

    return { in: ti, check_ans: true, pass: pass }
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

async function getLastPRCommitUpdateTime(issue) {
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

main();