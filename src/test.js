const day_one = 86400000; //ms
function getDays(start, end) {
    let t_1 = getPass(Date.parse(end) - Date.parse(start));
    let mil_start = start.getTime();
    let mil_end = end.getTime();
    console.log(t_1)

    let holiday = 0;
    let work = 0;
    //完整的有几周
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

class time_pass {
    constructor(days, hours, minutes, seconds, milliseconds, holiday, mile_total) {
        this.days = days;
        this.hours = hours;
        this.minutes = minutes;
        this.seconds = seconds;
        this.milliseconds = milliseconds;
        this.mile_total = mile_total;
    }
}

function getPass(duration) {
    let milliseconds = duration % 1000;
    duration = parseInt(duration / 1000);
    let seconds = duration % 60;
    duration = parseInt(duration / 60);
    let minutes = duration % 60;
    duration = parseInt(duration / 60);
    let hours = duration % 24;
    duration = parseInt(duration / 24);
    let days = duration;
    return new time_pass(days, hours, minutes, seconds, milliseconds, duration);
}

function main() {
    let start = new Date(2022, 10, 5, 6, 0, 0, 0);
    console.log(start)
    // let now = new Date(2022, 11, 14, 0, 0, 0, 0);
    let now = new Date();
    console.log(now);
    let { work, holiday } = getDays(start, now);
    console.log(JSON.stringify(work));
    console.log(JSON.stringify(holiday));
}

main();