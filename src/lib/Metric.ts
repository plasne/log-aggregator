
// includes
import moment = require("moment");
import Testable, { TestableJSON } from "./Testable";

export interface DataPoint {
    ts: string,
    v: number
}

export interface MetricJSON extends TestableJSON {
    name:     string,
    node?:    string,
    file?:    string,
    entries?: Array<DataPoint>
}

export interface Chart {
    time: Array<string>,
    data: Array<number>
}

export default class Metric extends Array<DataPoint> {

    public  readonly name:      string;
    public           node:      string;
    public           file?:     string;
    public           committed: string = "";
    private          testable?: Testable;

    public add(v: number): void {
        const ts = moment().utc().format("YYYY-MM-DDTHH:mm");
        const last = this[this.length - 1];
        if (last && last.ts === ts) {
            global.logger.log("silly", `during metric add, metric "${this.name}" on node "${this.node}" for file "${this.file}" @ "${ts}" was ${last.v} + ${v} = ${last.v + v}.`);
            last.v += v;
        } else {
            this.push({
                ts: ts,
                v: v
            });
            global.logger.log("silly", `during metric add, metric "${this.name}" on node "${this.node}" for file "${this.file}" @ "${ts}" was created = ${v}.`);
        }
    }

    public offer(rows: Array<any>): void {

        // filter
        const filtered = rows.filter(row => {
            if (!this.testable) return true;
            if (!this.testable.testAnd(row)) return false;
            if (!this.testable.testOr(row)) return false;
            if (!this.testable.testNot(row)) return false;
            return true;
        });
        global.logger.log("debug", `${filtered.length} of ${rows.length} rows were accepted by "${this.name}".`);

        // add whatever survived the filter
        if (filtered.length > 0) {
            this.add(filtered.length);
        }

    }

    public uncommitted(): Array<DataPoint> | null {

        // advance the start, or start at 0 on first
        let start = this.findIndex(entry => entry.ts === this.committed);
        if (start > -1) {
            start++;
        } else {
            start = 0;
        }
        const end = this.length;
        global.logger.log("silly", `during get uncommitted for metric "${this.name}" for file "${this.file}", the entries from ${start} (inclusive) to ${end} (exclusive) will be sent.`);

        // if there are uncommitted, return them
        if (start < end) {

            // get the appropriate list (didn't use slice since I wanted an Array, not Metric)
            const list = [];
            for (let i = start; i < end; i++) {
                list.push(this[i]);
            }

            // remove the last entry if it possibly isn't closed
            const ts = moment().utc().format("YYYY-MM-DDTHH:mm");
            const last = list[list.length - 1];
            if (last.ts === ts) {
                list.splice(-1);
                global.logger.log("silly", `during get uncommitted for metric "${this.name}" for file "${this.file}", the last entry was excluded because it is still open, leaving ${list.length} entries.`);
            } else {
                global.logger.log("silly", `during get uncommitted for metric "${this.name}" for file "${this.file}", ${list.length} entries will be sent (last "${last.ts}" vs current "${ts}").`);
            }
            
            return list;
        }

        return null;
    }

    public trim(): void {
        const max = 60 * 24 * 3; // 60 min * 24 hr * 3 days
        if (this.length > max) {
            this.splice(0, max - this.length);
        }
    }

    public merge(list: Array<DataPoint>) {
        for (const entry of list) {
            const existing = this.find(e => e.ts === entry.ts);
            if (existing) {
                existing.v = entry.v;
            } else {
                this.push(entry);
            }
        }
    }

    static chart(entries: Array<DataPoint>, pointer: moment.Moment, earliest: moment.Moment, rate: number): Chart {
        const chart = {
            time: [],
            data: []
        } as Chart;

        while (pointer > earliest) {
            const time: string = pointer.format();
            chart.time.push(time);
            let total = 0;
            for (let i = 0; i < rate; i++) {
                const ts = pointer.format("YYYY-MM-DDTHH:mm");
                const slice = entries.filter(entry => entry.ts === ts)
                for (const entry of slice) {
                    total += entry.v;
                }
                pointer.subtract(1, "minute");
            }
            chart.data.push(total);
        }

        return chart;
    }

    constructor(obj: MetricJSON) {
        super();

        // base properties
        this.name = obj.name;
        this.node = obj.node || global.node;
        if (obj.file) this.file = obj.file;

        // testable
        if (obj.and || obj.or || obj.not) this.testable = new Testable(obj);

        // entries
        if (obj.entries) {
            for (const entry of obj.entries) {
                this.push(entry);
            }
        }

    }

}