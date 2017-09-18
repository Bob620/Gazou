const fs = require('fs');

const aws = require('aws-sdk'),
      UploadStream = require('s3-upload-stream')(new aws.S3({apiVersion: '2006-03-01'}));

class S3Upload {
  constructor({maxUploadSec=5, bucket='i.bobco.moe', acl='public-read'}) {
    this.bucket = bucket;
    this.acl = acl;
    this.maxUploadSec = maxUploadSec;
    this.uploadedThisSec = 0;
    this.toUpload = [];

    this.resetTimeout = setTimeout(() => {
      this.uploadedThisSec = 0;
      this.upload();
    }, 1000);
  }

  upload() {
    while (this.uploadedThisSec < this.maxUploadSec && this.toUpload.length !== 0) {
      this.uploadedThisSec++;

      const request = this.toUpload.shift();
      const uploadStream = UploadStream.upload({Bucket: this.bucket, Key: request[1], ACL: this.acl})
      .once('uploaded', request[2])

      fs.createReadStream(request[0])
      .pipe(uploadStream);
    }
    if (this.toUpload.length > 0) {
      if (this.resetTimeout) {
        clearTimeout(this.resetTimeout);
      }
      this.resetTimeout = setTimeout(() => {
        this.uploadedThisSec = 0;
        this.upload();
      }, 1000);
    }
  }

  callback({resolve, reject}, data) {
    resolve(data);
  }

  push(itemUri, itemName) {
    return new Promise((resolve, reject) => {
      this.toUpload.push([itemUri, itemName, this.callback.bind(this, {resolve, reject})]);
      this.upload();
    });
  }
}

module.exports = S3Upload;