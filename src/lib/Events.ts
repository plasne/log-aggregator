
// includes
import axios from "axios";
import moment = require("moment");

export interface Event {
    ts:         string,
    type:       string,
    node:       string,
    msg:        string
    committed?: boolean
}

export default class Events extends Array<Event> {

    public url?: string;

    uncommitted() {

        // find any uncommitted records
        let start = this.findIndex(entry => !entry.committed);
        if (start < 0) return [];
        const end = this.length;
        global.logger.log("silly", `during get uncommitted for events, the entries from ${start} (inclusive) to ${end} (exclusive) will be sent.`);

        // get the appropriate list (didn't use slice since I wanted an Array, not Events)
        const list = [];
        for (let i = start; i < end; i++) {
            list.push(this[i]);
        }
        return list;

    }

    trim() {

        // only allow items up to 3 days old
        const min = moment().subtract(3, "days").toISOString();

        // find the start of the recent entries
        let start = 0;
        for (let i = 0; i < this.length; i++) {
            if (this[i].ts > min) {
                start = i;
                break;
            }
        }

        // trim
        if (start > 0) {
            this.splice(0, start);
        }

    }

    async send() {
        if (!this.url) return;
        try {

            // craft the message
            const events = this.uncommitted();

            // send only if there is data
            if (events.length > 0) {

                // post the message to the controller
                global.logger.log("verbose", `posting ${events.length} events to "${this.url}"...`);
                await axios.post(this.url, events);
                global.logger.log("verbose", `posted ${events.length} events to "${this.url}".`);

                // mark as committed
                for (const event of events) {
                    event.committed = true;
                }

                // trim
                this.trim();

            }

        } catch (error) {
            // NOTE: metrics do not retry, they will dispatch again in a minute
            global.logger.error("error posting events to the controller.");
            global.logger.error(error.stack);
        }
    }

    constructor(url?: string) {
        super();

        // if a URL is present, record it and send to it every minute
        //  NOTE: I was checking for string because when I was using splice,
        //    the constructor was being called with the number of elements in the new array
        if (url && typeof url === "string") {
            this.url = url;
            setInterval(_ => { this.send(); }, 60000);
        }

    }

}