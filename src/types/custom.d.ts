
import * as winston from "winston";
import Metrics from "../lib/Metrics";
import Checkpoints from "../lib/Checkpoints";
import LogFiles from "../lib/LogFiles";
import Configurations from "../lib/Configurations";
import { BlobService } from "azure-storage";

declare global {

    namespace NodeJS {
        interface Global {
            node: string,
            batchSize: number,
            chunkSize: number,
            dispatchInterval: number,
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

}

declare module "azure-storage" {
    module services {
        module blob {
            module blobservice {
                interface BlobService {
                    listBlobsSegmented(container: string, currentToken: common.ContinuationToken | null, callback: ErrorOrResult<BlobService.ListBlobsResult>): void;
                }
            }
        }
    }
}

// support null for continuation token in TS
declare module "azure-storage" {
    module services {
        module blob {
            module blobservice {
                interface BlobService {
                    listBlobsSegmented(container: string, currentToken: common.ContinuationToken | null, callback: ErrorOrResult<BlobService.ListBlobsResult>): void;
                }
            }
        }
    }
}