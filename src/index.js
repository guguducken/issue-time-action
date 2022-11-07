const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

//get variables
const uri_warn = core.getInput('uri_warn', { required: true });
const token = core.getInput('token_action', { required: true });
const warn_time = core.getInput('warning_time', { required: true });
const label_check = core.getInput('label_check', { required: true });
const label_skip = core.getInput('label_skip', { required: false });
const type_message = core.getInput('type', { required: false });

// const repo = github.context.repo
const repo = {
    repo: "matrixone",
    owner: "matrixorigin"
}


//get oc client
const oc = github.getOctokit(token);
const arr_label_skip = label_skip.split(",");
const arr_label_check = label_check.split(",");
const arr_warn_time = warn_time.split(" ");

//get the timestamp of now
const t_now = new Date().getTime();
let t_warn = parseMillSecond(parseArray(arr_warn_time));

function parseMillSecond(arr) {
    let t = new Array();
    for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        t.push(e * 86400000);
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
        let per_page = 100;
        let now = 1;
        let mess_warn = new Array(t_warn.length);
        for (let i = 0; i < mess_warn.length; i++) {
            mess_warn[i] = { message: ">>>>>>" + arr_label_check[i] + "<<<<<<", num: 0 };
        }
        while (true) {
            let issues = await getIssues(now, per_page);
            if (issues === undefined) {
                core.info(">>>>>>> Job finish <<<<<<<");
                break;
            }
            now++;
            for (let i = 0; i < issues.length; i++) {
                const e = issues[i];
                let ind_label = checkLabel(e);
                if (e.pull_request !== undefined || skipLabel(e) || ind_label == -1) { //跳过后续的检查和发送通知
                    // core.info("skip PR/issue " + e.number + ": " + e.title + " <<<<<<<<\n");
                    continue;
                }
                num_sum++;

                //检查更新时间
                let time_update = await getLastPRCommitUpdateTime(e);
                if (time_update === null) {
                    time_update = {
                        updatedAt: e.created_at,
                    }
                }
                let check_update = await TimeCheck(time_update.updatedAt, ind_label);
                if (!check_update.check_ans) {
                    let m = await getMessage("warning", issues[i], check_update);
                    mess_warn[ind_label].message += m;
                    mess_warn[ind_label].num++;
                    num_warn++;
                    core.info(">>> Warning " + num_warn + "issue: " + e.number + " - " + e.title + " update time: " + time_update.updatedAt);
                    continue;
                }
            }
        }
        for (let i = 0; i < mess_warn.length; i++) {
            const e = mess_warn[i];
            if (e.num == 0) {
                core.info(arr_label_check[i] + " is not expired <<<<");
                continue;
            }
            sendWeComMessage(uri_warn, type_message, mess_warn[i].message, "");
        }
        core.info();
        core.info("total warning: " + num_warn);
        core.info("total issues: " + num_sum);
    } catch (err) {
        core.setFailed(err.message);
    }
}

//get issues by issue
async function getIssues(now, num_page) {
    const { data: iss } = await oc.rest.issues.listForRepo(
        {
            ...repo,
            state: "open",
            sort: "created",
            direction: "desc",
            per_page: num_page,
            page: now
        }
    );
    core.info(JSON.stringify(iss));
    if (iss.length == 0) {
        return undefined;
    }
    return iss;
}

async function getMessage(type, issue, check) {
    let message = "";
    let assig = "";
    if (issue.assignees.length != 0) {
        for (let i = 0; i < issue.assignees.length; i++) {
            const u = issue.assignees[i];
            assig = "[" + u.login + "](" + u.html_url + ")" + "," + assig;
        }
        if (assig[assig.length - 1] == ',') {
            assig = assig.substring(0, assig.length - 1);
        }
    }
    switch (type) {
        case "warning":
            if (issue.assignees.length != 0) {
                message = `<font color=\"info\">[Issue Expiration Warning]</font>\n[${issue.title}](${issue.html_url})\nAssignees: **${assig}**\nRepo: ${repo.owner}/${repo.repo}\nNumber: ${issue.number}\nCreate_At: ${issue.created_at}\nPassed: ${check.pass}\n`
                break;
            }
            message = `<font color=\"info\">[Issue Expiration Warning]</font>\n[${issue.title}](${issue.html_url})\nAssignees: **No Assignee**\nRepo: ${repo.owner}/${repo.repo}\nNumber: ${issue.number}\nCreate_At: ${issue.created_at}\nPassed: ${check.pass}\n`
            break;
        case "error":
            if (issue.assignees.length != 0) {
                message = `<font color=\"warning\">[Issue Expired Warning]</font>\n[${issue.title}](${issue.html_url})\nAssignees: **${assig}**\nRepo: ${repo.owner}/${repo.repo}\nNumber: ${issue.number}\nUpdate_At: ${check.in}\nPassed: ${check.pass}\n`
                break;
            }
            message = `<font color=\"warning\">[Issue Expired Warning]</font>\n[${issue.title}](${issue.html_url})\nAssignees: **No Assignee**\nRepo: ${repo.owner}/${repo.repo}\nNumber: ${issue.number}\nUpdate_At: ${check.in}\nPassed: ${check.pass}\n`
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
    core.info("in TimeCheck: " + pass + " dura_t: " + dura_t);

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

function checkLabel(issue) {
    if (label_check.length == 0) {
        return -1
    }
    for (let i = 0; i < issue.labels.length; i++) {
        const label = issue.labels[i].name;
        for (let j = 0; j < arr_label_check.length; j++) {
            const e = arr_label_check[j];
            if (label === e) {
                return j
            }
        }
    }
    return -1
}

async function getLastPRCommitUpdateTime(issue) {
    let query = `query ($repo: String!, $repo_owner: String!, $number_iss: Int!, $First: Int, $Skip: Int) {
  repository(name: $repo, owner: $repo_owner) {
    issue(number: $number_iss) {
      id
      timelineItems(first: $First, skip: $Skip) {
        updatedAt
        edges {
          node {
            ... on CrossReferencedEvent {
              source {
                ... on PullRequest {
                  id
                  updatedAt
                  title
                  createdAt
                }
              }
            }
            ... on IssueComment {
              id
              updatedAt
              createdAt
              body
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  }
}`;
    let hasNext = true;
    let start = 0;
    let per_page = 20;
    let lastUpdate = 0;
    let lastPRORCommit = null;

    while (hasNext) {
        let { repository } = await oc.graphql(query, {
            "repo": repo.repo,
            "repo_owner": repo.owner,
            "number_iss": issue.number,
            "First": per_page,
            "Skip": start
        });
        hasNext = repository.issue.timelineItems.pageInfo.hasNextPage;
        start += per_page;
        let edges = repository.issue.timelineItems.edges;
        for (let i = 0; i < edges.length; i++) {
            const e = edges[i];
            if (e.node !== undefined && e.node.source !== undefined && Object.keys(e.node).length != 0 && Object.keys(e.node.source).length != 0) {
                t = Date.parse(e.node.source.updatedAt);
                if (t > lastUpdate) {
                    lastUpdate = t;
                    lastPRORCommit = e.node.source;
                }
            }
        }
    }
    return lastPRORCommit;
}

main();