

if (!Array.prototype.remove) {
    Array.prototype.remove = function<T>(obj: T): void {
        const index = this.indexOf(obj);
        if (index > -1) this.splice(index, 1);
    }
}

if (!Array.prototype.removeAll) {
    Array.prototype.removeAll = function<T>(list: T[]): void {
        for (const element of list) {
            const index = this.indexOf(element);
            if (index > -1) this.splice(index, 1);
        }
    }
}
