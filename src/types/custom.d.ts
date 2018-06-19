
import * as winston from "winston";
import Metrics from "../lib/Metrics";
import Checkpoints from "../lib/Checkpoints";
import LogFiles from "../lib/LogFiles";
import Configurations from "../lib/Configurations";
import Events_ from "../lib/Events";

declare global {

    namespace NodeJS {
        interface Global {
            node: string,
            batchSize: number,
            chunkSize: number,
            logger:  winston.Logger;
            configurations: Configurations;
            events: Events_;
            metrics: Metrics;
            checkpoints: Checkpoints;
            logFiles: LogFiles
        }
    }

    interface Array<T> {
        remove(o: T): void;
        removeAll(o: T[]): void;
    }

    interface String {
        combineAsPath(...parts: string[]): string;
    }

}
