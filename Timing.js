class Timing {
  constructor(baseTime=process.uptime()) {
    this.baseTime = baseTime;
    this.times = new Map();
  }

  get(id) {
    const time = this.times.get(id);
    if (time === undefined) {
      throw new Error(`Unable to retrive time for '${id}'`);
    }
    return time;
  }

  setNow(id) {
    this.times.set(id, process.uptime());
  }

  setRelative(id, relativeTimeId) {
    this.times.set(id, process.uptime() - this.get(relativeTimeId))
  }

  set(id, time) {
    this.times.set(id, time);
  }
}

module.exports = Timing;