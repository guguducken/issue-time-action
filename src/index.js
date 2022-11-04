const core = require('@actions/core');
const github = require('@actions/github');
//get variables
const token = core.getInput('token_action', { required: true });
const warn_days = core.getInput('warning_days', { required: false });
const error_days = core.getInput('error_days', { required: true });

const repo = github.context.repo

//get oc client
const oc = github.getOctokit(token);


async function main() {
    try {
        //coding
    } catch (err) {
        core.setFailed(err.message);
    }
}

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
    )
    if (iss.length == 0) {
        return null
    }
    return iss
}

main();