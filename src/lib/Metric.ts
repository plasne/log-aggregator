
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
    config?:  string,
    file?:    string,
    counter?: number,
    entries?: DataPoint[]
}

export interface Series<T> {
    name: string,
    data: T[]
}

export interface Chart {
    name?:  string,
    time:   string[],
    series: Series<number>[]
}

export default class Metric extends Array<DataPoint> {

    public  readonly name:      string;
    public           node:      string;

    /** The name of the config that this file is derived from. If you change config, you should also change file. */
    public           config?:   string;

    /** The name of the actual file that this metric applies to. If you change file, you should also change config. */
    public           file?:     string;

    public           committed: string = "";
    public           counter:   number = 0;
    private          testable?: Testable;

    public add(v: number): void {
        const ts = moment().utc().format("YYYY-MM-DDTHH:mm");
        const last = this[this.length - 1];
        if (last && last.ts === ts) {
            global.logger.log("silly", `during metric add, metric "${this.name}" on node "${this.node}" for config "${this.config}" and file "${this.file}" @ "${ts}" was ${last.v} + ${v} = ${last.v + v}.`);
            last.v += v;
        } else {
            this.push({
                ts: ts,
                v: v
            });
            global.logger.log("silly", `during metric add, metric "${this.name}" on node "${this.node}" for config "${this.config}" and file "${this.file}" @ "${ts}" was created = ${v}.`);
        }
    }

    public offer(rows: any[]): void {

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

    public uncommitted(): DataPoint[] | null {

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

    public merge(list: DataPoint[]) {
        for (const entry of list) {
            const existing = this.find(e => e.ts === entry.ts);
            if (existing) {
                this.counter = this.counter - existing.v + entry.v;
                existing.v = entry.v;
            } else {
                this.counter += entry.v;
                this.push(entry);
            }
        }
    }

    sum(since?: moment.Moment) {
        const ts = (since) ? since.utc().format("YYYY-MM-DDTHH:mm") : undefined;
        let total = 0;
        for (const entry of this) {
            if (!ts || entry.ts >= ts) total += entry.v;
        }
        return total;
    }

    static chart(series: Series<DataPoint>[], pointer: moment.Moment, earliest: moment.Moment, rate: number): Chart {

        // initialize
        pointer = pointer.clone();
        const chart = {
            time:   [],
            series: []
        } as Chart;
        for (const _series of series) {
            chart.series.push({
                name: _series.name,
                data: []
            });
        }

        // create the series
        while (pointer > earliest) {
            const time: string = pointer.format();
            chart.time.push(time);
            const totals: {
                [index: number]: number
            } = {};
            for (let i = 0; i < rate; i++) {
                const ts = pointer.format("YYYY-MM-DDTHH:mm");
                for (let j = 0; j < series.length; j++) {
                    const slice = series[j].data.filter(entry => entry.ts === ts);
                    for (const entry of slice) {
                        totals[j] = (totals[j] || 0) + entry.v;
                    }
                }
                pointer.subtract(1, "minute");
            }
            for (let i = 0; i < series.length; i++) {
                chart.series[i].data.push(totals[i] || 0);
            }
        }

        return chart;
    }

    toJSON(): MetricJSON {

        // create a list of entries (didn't use slice since it would clone Metric)
        const entries: DataPoint[] = [];
        for (let entry of this) {
            entries.push(entry);
        }

        // return the JSON
        return {
            name: this.name,
            node: this.node,
            config: this.config,
            file: this.file,
            counter: this.counter,
            entries: entries
        } as MetricJSON;

    }

    constructor(obj: MetricJSON) {
        super();

        // base properties
        this.name = obj.name;
        this.node = obj.node || global.node;
        if (obj.config) this.config = obj.config;
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