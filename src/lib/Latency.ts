
class Bucket {

    public range:  number;
    public total:  number = 0;
    public count:  number = 0;
    public avg:    number = 0;
    public min:    number = Number.MAX_VALUE;
    public max:    number = Number.MIN_VALUE;

    public calc(times: number[]) {

        // trim down to the range
        const trimmed = times.slice(0);
        const trimBy = Math.ceil( (1.0 - this.range) * trimmed.length );
        trimmed.splice(-trimBy, trimBy);

        // calculate
        this.count = trimmed.length;
        for (let time of trimmed) {
            this.total += time;
            if (time < this.min) this.min = time;
            if (time > this.max) this.max = time;
        }
        this.avg = Math.ceil(this.total / this.count);

    }

    constructor(range: number) {
        this.range = range;
    }
}

export default class Latency {

    public times: number[] = [];

    public get count() {
        return this.times.length;
    }

    public add(time: number) {
        if (Array.isArray(time)) {
            this.times = this.times.concat(time);
        } else {
            this.times.push(time);
        }
    }

    public calc() {

        // sort the times (ascending)
        this.times.sort((a, b) => { return a - b; });

        // create the buckets to examine
        const buckets = [
            new Bucket(1.0),
            new Bucket(0.9999),
            new Bucket(0.999),
            new Bucket(0.99),
            new Bucket(0.95),
            new Bucket(0.90)
        ];

        // calculate
        for (let bucket of buckets) {
            bucket.calc(this.times);
        }

        return buckets;
    }

}