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

const repo = github.context.repo

//get oc client
const oc = github.getOctokit(token);
const arr_warn = warn_time.split(" ");
const arr_error = error_time.split(" ");
const arr_label = label_skip.split(",");

//get the timestamp of now
const t_now = new Date().getTime();

async function checkFirst() {
    if (arr_warn.length != 5 || arr_error.length != 5) {
        throw new Error("The time of warning or error is invalid. Please check your Input")
    }
    if (uri_error.length == 0) {
        throw new Error("The Webhook of error notice(uri_error) is invalid");
    }
}

async function main() {
    try {
        //check input
        checkFirst();

        let num_warn = 0;
        let num_error = 0;

        //coding
        let per_page = 100;
        let now = 1;
        while (true) {
            let issues = await getIssues(now, per_page);
            if (issues === undefined) {
                break;
            }
            now++;
            for (let i = 0; i < issues.length; i++) {
                const e = issues[i];
                if (e.pull_request === undefined || checkLabel(e)) {
                    continue;
                }
                let ans = TimeCheck(e.created_at);
                if (ans == 1 && uri_warn.length != 0) {
                    sendWeComMessage(uri_warn, type_message, await getMessage("warning", issues[i]), "");
                    num_warn++;
                    continue;
                }
                if (ans == 2) {
                    sendWeComMessage(uri_error, type_message, await getMessage("error", issues[i]), "");
                    num_error++;
                    continue;
                }

            }
        }
        core.info();
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

async function getMessage(type, issue) {
    let message = "";
    let assignees = "";
    for (let i = 0; i < issue.assignees.length; i++) {
        const u = issue.assignees[i];
        assignees = assignees + "," + u.login;
    }
    switch (type) {
        case "warning":
            message = `<font color=\"info\">[Issue Expiration Warning]</font>\n[${issue.title}](${issue.url})\nAssignees: **${assignees}**\nRepo: ${repo.owner}/${repo.repo}\nNumber: ${issue.number}`
            break;
        case "error":
            message = `<font color=\"warning\">[Issue Expired Warning]</font>\n[${issue.title}](${issue.url})\nAssignees: **${assignees}**\nRepo: ${repo.owner}/${repo.repo}\nNumber: ${issue.number}`
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
        return 0;
    }
    let duration = t.now - t_in;
    let millisecond = duration % 1000;
    duration /= 1000;

    let second = duration % 60;
    duration /= 60;

    let minute = duration % 60;
    duration /= 60;

    let hour = duration % 24;
    duration /= 24;

    let day = duration;

    //error check
    if (error_time.length != 0) {
        if (day > parseInt(arr_error[0])) {
            return 2
        }
        if (hour > parseInt(arr_error[1])) {
            return 2
        }
        if (minute > parseInt(arr_error[2])) {
            return 2
        }
        if (second > parseInt(arr_error[3])) {
            return 2
        }
        if (millisecond > parseInt(arr_error[4])) {
            return 2
        }
    }
    //warning check
    if (warn_time.length != 0) {
        if (day > parseInt(arr_warn[0])) {
            return 1
        }
        if (hour > parseInt(arr_warn[1])) {
            return 1
        }
        if (minute > parseInt(arr_warn[2])) {
            return 1
        }
        if (second > parseInt(arr_warn[3])) {
            return 1
        }
        if (millisecond > parseInt(arr_warn[4])) {
            return 1
        }
    }
    return 0
}

async function checkLabel(issue) {
    if (label_skip.length == 0) {
        return false
    }
    for (let i = 0; i < issue.labels.length; i++) {
        const label = issue.labels[i];
        for (let j = 0; j < arr_label.length; j++) {
            const e = arr_label[j];
            if (label == e) {
                return true
            }
        }
    }
    return false

}

main();