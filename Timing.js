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

  getDiff(idOne, idTwo) {
    let timeOne;
    let timeTwo;
    if (idOne === 'baseTime') {
      timeOne = this.baseTime;
    } else {
      timeOne = this.get(idOne);
    }
    if (idTwo === 'baseTime') {
      timeTwo = this.baseTime;
    } else {
      timeTwo = this.get(idTwo);
    }

    const diff = timeTwo - timeOne;

    return diff > 0 ? diff : diff*-1
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