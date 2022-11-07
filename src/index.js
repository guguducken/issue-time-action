const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

//get variables
const token = core.getInput('token_action', { required: true });
const uri_error = core.getInput('uri_error', { required: true });
const error_time = core.getInput('error_time', { required: true });
const type_message = core.getInput('type', { required: false });
const uri_warn = core.getInput('uri_warn', { required: false });
const warn_time = core.getInput('warning_time', { required: false });
const label_skip = core.getInput('label_skip', { required: false });
const label_check = core.getInput('label_check', { required: true });

const repo = github.context.repo
// const repo = {
//     repo: "matrixone",
//     owner: "matrixorigin"
// }

//get oc client
const oc = github.getOctokit(token);
const arr_warn = warn_time.split(" ");
const arr_error = error_time.split(" ");
const arr_label_skip = label_skip.split(",");
const arr_label_check = label_check.split(",");

//get the timestamp of now
const t_now = new Date().getTime();

function checkFirst() {
    if (arr_warn.length != 5 || arr_error.length != 5) {
        throw new Error("The time of warning or error is invalid. Please check your Input")
    }
    if (uri_error.length == 0) {
        throw new Error("The Webhook of error notice(uri_error) is invalid");
    }
    core.info("First check pass....");
}

async function main() {
    try {
        //check input
        checkFirst();
        core.info(arr_label_check);

        let num_warn = 0;
        let num_error = 0;

        //coding
        let per_page = 100;
        let now = 1;
        while (true) {
            let issues = await getIssues(now, per_page);
            if (issues === undefined) {
                core.info("Job finish....");
                break;
            }
            now++;
            for (let i = 0; i < issues.length; i++) {
                const e = issues[i];
                if (e.pull_request !== undefined || skipLabel(e) || !checkLabel(e)) { //跳过后续的检查和发送通知
                    core.info("skip PR/issue " + e.number + ": " + e.title + " <<<<<<<<");
                    continue;
                }

                core.info("check issue " + e.number + ": " + e.title + " >>>>>>>>");
                //检查是否超过最长完成时间
                core.info("cereate time: " + e.created_at);
                let check_create = await TimeCheck(e.created_at);
                if (check_create.check_ans == 2 && uri_error.length != 0) {
                    // sendWeComMessage(uri_error, type_message, await getMessage("error", issues[i], check_create), "");
                    num_error++;
                    continue;
                }

                //检查更新时间
                let time_update = await getLastPRCommitUpdateTime(e);
                core.info("pr or update time: " + time_update.updatedAt);
                let check_update = await TimeCheck(time_update);
                if (check_update.check_ans == 1 && uri_warn.length != 0) {
                    // sendWeComMessage(uri_warn, type_message, await getMessage("warning", issues[i], check_update), "");
                    num_warn++;
                    continue;
                }

            }
        }
        core.info();
        core.info("total warning: " + num_warn);
        core.info("total expired: " + num_error);
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
            direction: "asc",
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
    let assig = "";
    if (issue.assignees.length != 0) {
        for (let i = 0; i < issue.assignees.length; i++) {
            const u = issue.assignees[i];
            assig = u.login + "," + assig;
        }
        if (assig[assig.length - 1] == ',') {
            assig = assig.substring(0, assig.length - 1);
        }
    }
    switch (type) {
        case "warning":
            if (issue.assignees.length != 0) {
                message = `<font color=\"info\">[Issue Expiration Warning]</font>\n[${issue.title}](${issue.html_url})\nAssignees: **${assig}**\nRepo: ${repo.owner}/${repo.repo}\nNumber: ${issue.number}\nCreate_At: ${issue.created_at}\nPassed: ${check.pass}`
                break;
            }
            message = `<font color=\"info\">[Issue Expiration Warning]</font>\n[${issue.title}](${issue.html_url})\nAssignees: **No Assignee**\nRepo: ${repo.owner}/${repo.repo}\nNumber: ${issue.number}\nCreate_At: ${issue.created_at}\nPassed: ${check.pass}`
            break;
        case "error":
            if (issue.assignees.length != 0) {
                message = `<font color=\"warning\">[Issue Expired Warning]</font>\n[${issue.title}](${issue.html_url})\nAssignees: **${assig}**\nRepo: ${repo.owner}/${repo.repo}\nNumber: ${issue.number}\nUpdate_At: ${check.in}\nPassed: ${check.pass}`
                break;
            }
            message = `<font color=\"warning\">[Issue Expired Warning]</font>\n[${issue.title}](${issue.html_url})\nAssignees: **No Assignee**\nRepo: ${repo.owner}/${repo.repo}\nNumber: ${issue.number}\nUpdate_At: ${check.in}\nPassed: ${check.pass}`
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
async function TimeCheck(ti) {
    let t_in = Date.parse(ti);
    if (t_in >= t_now) {
        return { in: ti, check_ans: 0, pass: "0d-0h:0m:0s" }
    }
    let duration = t_now - t_in;
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
    core.info("in TimeCheck: " + pass);

    //error check
    if (error_time.length != 0) {
        if (day > parseInt(arr_error[0])) {
            return { in: ti, check_ans: 2, pass: pass }
        }
        if (hour > parseInt(arr_error[1])) {
            return { in: ti, check_ans: 2, pass: pass }
        }
        if (minute > parseInt(arr_error[2])) {
            return { in: ti, check_ans: 2, pass: pass }
        }
        if (second > parseInt(arr_error[3])) {
            return { in: ti, check_ans: 2, pass: pass }
        }
        if (millisecond > parseInt(arr_error[4])) {
            return { in: ti, check_ans: 2, pass: pass }
        }
    }
    //warning check
    if (warn_time.length != 0) {
        if (day > parseInt(arr_warn[0])) {
            return { in: ti, check_ans: 1, pass: pass }
        }
        if (hour > parseInt(arr_warn[1])) {
            return { in: ti, check_ans: 1, pass: pass }
        }
        if (minute > parseInt(arr_warn[2])) {
            return { in: ti, check_ans: 1, pass: pass }
        }
        if (second > parseInt(arr_warn[3])) {
            return { in: ti, check_ans: 1, pass: pass }
        }
        if (millisecond > parseInt(arr_warn[4])) {
            return { in: ti, check_ans: 1, pass: pass }
        }
    }
    return { in: ti, check_ans: 0, pass: pass }
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
        return false
    }
    for (let i = 0; i < issue.labels.length; i++) {
        const label = issue.labels[i].name;
        for (let j = 0; j < arr_label_check.length; j++) {
            const e = arr_label_check[j];
            if (label === e) {
                return true
            }
        }
    }
    return false
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
            if (e.node !== undefined || e.node.source !== undefined || Object.keys(e.node).length != 0 || Object.keys(e.node.source).length != 0) {
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