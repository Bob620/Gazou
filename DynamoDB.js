const aws = require('aws-sdk');

class DynamoDB {
  constructor({maxUploadSec=5, maxDownloadSec=5, region='us-west-2', apiVersion='2012-08-10'}) {
    this.dynamodb = new aws.DynamoDB({apiVersion, region});
    this.maxUploadSec = maxUploadSec;
    this.maxDownloadSec = maxDownloadSec;
    this.uploadedThisSec = 0;
    this.downloadedThisSec = 0;
    this.toUpload = [];
    this.toDownload = [];

    this.resetTimeout = setTimeout(() => {
      this.uploadedThisSec = 0;
      this.downloadedThisSec = 0;
      this.upload();
      this.download();
    }, 1000);
  }

  upload() {
    while (this.uploadedThisSec < this.maxUploadSec && this.toUpload.length !== 0) {
      this.uploadedThisSec++;

      const request = this.toUpload.shift();
      this.dynamodb.updateItem(request[0], request[1]);
    }
    if (this.toUpload.length > 0) {
      if (this.resetTimeout) {
        clearTimeout(this.resetTimeout);
      }
      this.resetTimeout = setTimeout(() => {
        this.uploadedThisSec = 0;
        this.downloadedThisSec = 0;
        this.upload();
        this.download();
      }, 1000);
    }
  }

  download() {
    while (this.downloadedThisSec < this.maxDownloadSec && this.toDownload.length !== 0) {
      this.downloadedThisSec++;

      const request = this.toDownload.shift();
      this.dynamodb.scan(request[0], request[1]);
    }
    if (this.toDownload.length > 0) {
      if (this.resetTimeout) {
        clearTimeout(this.resetTimeout);
      }
      this.resetTimeout = setTimeout(() => {
        this.uploadedThisSec = 0;
        this.downloadedThisSec = 0;
        this.upload();
        this.download();
      }, 1000);
    }
  }

  callback({resolve, reject}, err, data) {
    if (err) {
      reject(err);
    } else {
      resolve(data);
    }
  }

  updateItem(item) {
    return new Promise((resolve, reject) => {
      this.toUpload.push([item, this.callback.bind(this, {resolve, reject})]);
      this.upload();
    });
  }

  scan(params) {
    return new Promise((resolve, reject) => {
      this.toDownload.push([params, this.callback.bind(this, {resolve, reject})]);
      this.download();
    });
  }
}

module.exports = DynamoDB;