
import * as winston from "winston";
import Metrics from "../lib/Metrics";
import Checkpoints from "../lib/Checkpoints";
import LogFiles from "../lib/LogFiles";
import Configurations from "../lib/Configurations";

declare global {

    namespace NodeJS {
        interface Global {
            node: string,
            batchSize: number,
            chunkSize: number,
            logger:  winston.Logger;
            configurations: Configurations;
            metrics: Metrics;
            checkpoints: Checkpoints;
            logFiles: LogFiles
        }
    }

    type resolveToKey<T> = string | number | ((x: T) => string | number | null | undefined)

    interface grouping<T> {
        key:    string,
        values: T[]
    }

    interface differences<T> {
        sourceOnly: T[],
        targetOnly: T[]
    }

    interface Array<T> {
        remove(o: T): void;
        removeAll(o: T[]): void;
        groupBy(key: resolveToKey<T>): grouping<T>[];
        diff(target: T[]): differences<T>;
    }

    interface String {
        combineAsPath(...parts: string[]): string;
    }

}
