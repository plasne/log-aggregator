
if (!Array.prototype.diff) {
    Array.prototype.diff = function<T>(target: T[]): differences<T> {
        const differences = {
            sourceOnly: [] as T[],
            targetOnly: [] as T[]
        }
        for (const element of this) {
            if (!target.includes(element)) differences.sourceOnly.push(element);
        }
        for (const element of target) {
            if (!this.includes(element)) differences.targetOnly.push(element);
        }
        return differences;
    };
}
