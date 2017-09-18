const fs = require('fs'),
      util = require('util'),
      EventEmitter = require('events'),
      crypto = require('crypto');

const aws = require('aws-sdk'),
      kagi = require('kagi');
      aws.config.update(kagi.getChain('kagi.chn').getLink('credentials'));
      program = require('commander'),
      UploadStream = require('s3-upload-stream')(new aws.S3({apiVersion: '2006-03-01'})),
      DynamoDB = require('./DynamoDB.js'),
      S3Upload = require('./S3Upload.js'),
      request = require('request');

const readdir = util.promisify(fs.readdir),
      dynamodb = new DynamoDB({});
      s3Upload = new S3Upload({});

program.version('1.0.0')
  .option('-x, --max <n>', 'An integer of the max new images to upload', parseInt)
  .option('-u, --update', 'Update old items')
  .option('-p, --push', 'Push new items')
  .arguments('[dir]')
  .action((dir='.', options) => {
    if (fs.statSync(dir).isDirectory() !== true) {
      throw 'Please provide a valid directory';
    }

    if (options.max === undefined) {
      options.max = 5000;
    }
    if (options.update === undefined) {
      options.update = false;
    } else {
      options.update = true;
    }
    if (options.push === undefined) {
      options.push = false;
    } else {
      options.push = true;
    }

    processDir(dir, options);
  });

function processDir(directory, options) {
  console.log('Processing Directory...\n');
  const startTime = process.uptime();
  let discoveredTime;
  let rootDirectory = new Directory(directory);

  rootDirectory.once('ready', () => {
    discoveredTime = process.uptime();
    console.log(`All images discovered in ${discoveredTime - startTime} sec\nchecking images for dups...`);
    let allImages = new Map();

    rootDirectory.images.forEach((newImage) => {
      if (!allImages.has(image.hash)) {
        allImages.set(image.hash, image);
      } else {
        const originalImage = allImages.get(image.hash);

        image.localCopies.forEach((imageUri) => {
          if (originalImage.localCopies.indexOf(imageUri) === -1) {
            originalImage.localCopies.push(imageUri);
          }
        });

        image.tags.forEach((tag) => {
          if (originalImage.tags.indexOf(tag) === -1) {
            originalImage.tags.push(tag);
          }
        });
      }
    });

    rootDirectory.directories.forEach((dir) => {
      dir.images.forEach((image) => {
        const imageStartTime = process.uptime();
        if (!allImages.has(image.hash)) {
          allImages.set(image.hash, image);
        } else {
          const originalImage = allImages.get(image.hash);

          image.localCopies.forEach((imageUri) => {
            if (originalImage.localCopies.indexOf(imageUri) === -1) {
              originalImage.localCopies.push(imageUri);
            }
          });

          image.tags.forEach((tag) => {
            if (originalImage.tags.indexOf(tag) === -1) {
              originalImage.tags.push(tag);
            }
          });
        }
        const returnTime = process.uptime() - imageStartTime;
      });
    });

    let totalImages = 0;
    let copies = 0;

    allImages.forEach((image) => {
      const occurance = image.localCopies.length;
      totalImages += occurance;
      if (occurance > 1) {
        copies += occurance-1;
      }
    });

    console.log(`Images compared in ${process.uptime() - discoveredTime} sec\n`);
    console.log(`Found ${copies} copies.\n`);
    console.log(`Total images found: ${totalImages}`);
    console.log(`Unique images found: ${allImages.size}\n`);
    console.log(`Total time took: ${process.uptime() - startTime} sec\n`);
    
    let bigImages = rootDirectory.bigImages;
    
    rootDirectory.directories.forEach((directory) => {
      bigImages = bigImages.concat(directory.bigImages);
    });

    console.log(`Found ${bigImages.length} images over 8MB (Max discord upload size)\n`);
    bigImages.forEach((image) => {
      console.log(image);
    })

    console.log('\nComparing to local store...');

    // Retrive the local store, if it exists, and cross-refrence data
    fs.readFile(`${directory}/localStore.json`, (err, data) => {
      let localStore;
      if (err === null && data !== null) {
        localStore = new Map(JSON.parse(data));
      } else {
        localStore = new Map();
      }
      
      let differences = new Map();
      updates = 0;

      allImages.forEach((image, hash) => {
        updates++;
        if (!localStore.has(hash)) {
          localStore.set(hash, image);
          differences.set(hash, image);
        } else {
          localImage = localStore.get(hash);
          localImage.tags.forEach((tag) => {
            if (image.tags.indexOf(tag) === -1) {
              image.tags.push(tag);
            }
          });
          localStore.set(hash, image);
        }
      });

      console.log(`${differences.size} new images since last update\n${updates} images updated\n`);

      console.log('Downloading comparison data for remote images...');
      const startDownloadTime = process.uptime();

      let params = {
        TableName: 'picturebase'
      }
      let remoteStore = new Map();
      let imagePromises = [];

      dynamodb.scan(params).then(async (data) => {
        data.Items.forEach((item) => {
          const image = new ImageFromAws(item);
          remoteStore.set(image.hash, image);
        });

        params.ExclusiveStartKey = data.LastEvaluatedKey;

        while (params.LastEvaluatedKey !== undefined) {
          const data = await dynamodb.scan(params);

          data.Items.forEach((item) => {
            const image = new ImageFromAws(item);
            remoteStore.set(image.hash, image);
          });

          params.ExclusiveStartKey = data.LastEvaluatedKey;
        }

        Promise.all(imagePromises).then(() => {
          console.log(`Downloaded remote store containing ${remoteStore.size} images`);
          console.log(`Remote images retrived in ${process.uptime() - startDownloadTime} secs\n`);
          console.log('Comparing local and remote stores\n');
  
          const startRemoteCompare = process.uptime();
  
          let diffToSync = [];
          let newToSync = [];
          let remoteCopies = 0;

          localStore.forEach((localImage, hash) => {
            if (!remoteStore.has(hash)) {
              // Local has an image remote doesn't
              newToSync.push(localImage);
            } else {
              remoteCopies++;
              const remoteImage = remoteStore.get(hash);
              // Both remote and local have an image (Copy exists both locally and remotely)
              if (localImage.tags.length >= remoteImage.tags.length) {
                // Local contains a tag remote doesn't
                if (compareTags(localImage, remoteImage)) {
                  diffToSync.push(localImage);
                }
              }
            }
          });

          console.log(`Remote compared in ${process.uptime() - startRemoteCompare} secs\n`);
          console.log(`Found ${remoteCopies} copies.`);
//          console.log(`Found ${remoteUpdates} new images.`);
          console.log(`Found ${newToSync.length} new local images to sync`);
          console.log(`Found ${diffToSync.length} local images to sync for new tags`);

//          console.log(`Unique images found: ${localStore.size}\n`);
          
          fs.writeFile(`${directory}/localStore.json`, JSON.stringify([...localStore]), (err) => {
            if (err) {
              console.log('Unable to update the local store\n');
            } else {
              console.log('Local store updated\n');
              console.log(`Full scan, comparison, and update completed in ${process.uptime() - startTime} sec\n`);

              let maxNewUploads = options.max < newToSync.length ? options.max : newToSync.length;

              let totalUploaded = 0;
              const uploadBar = new progressBar();
              
              if (options.update && diffToSync.length > 0) {
                console.log('Updating old images...');
                uploadBar.update(diffToSync.length, totalUploaded);

                new Promise((resolve, reject) => {
                  for (let i = 0; i < diffToSync.length; i++) {
                    const image = diffToSync[i];

                    dynamodb.updateItem({
                      ExpressionAttributeNames: {
                        '#tags': 'tags'
                      },
                      ExpressionAttributeValues: {
                        ':tags': {SS: image.tags}
                      },
                      Key: {
                        'uid': {S: image.hash}
                      },
                      UpdateExpression: "SET #tags = :tags",
                      TableName: 'picturebase'
                    }).then((data) => {
                      uploadBar.update(diffToSync.length, ++totalUploaded);
                      if (totalUploaded === diffToSync.length) {
                        resolve();
                      }
                    }).catch((err) => {
                      throw err;
                    });
                  }
                }).then(() => {
                  console.log('\nOld images updated');
                  
                  if (options.push && newToSync.length > 0) {
                    console.log('\nPushing new images...');
                    totalUploaded = 0;
                    uploadBar.update(maxNewUploads, totalUploaded);
    
                    new Promise((resolve, reject) => {
                      for (let i = 0; i < maxNewUploads; i++) {
                        const image = newToSync[i];
                        const imageUrl = image.hash + image.localCopies[0].substr(image.localCopies[0].lastIndexOf('.'));

                        s3Upload.push(image.localCopies[0], imageUrl).then((details) => {
                          dynamodb.updateItem({
                            ExpressionAttributeNames: {
                              '#uid': 'uid',
                              '#tags': 'tags',
                              '#url': 'url'
                            },
                            ExpressionAttributeValues: {
                              ':tags': {SS: image.tags},
                              ':uid': {S: image.hash},
                              ':url': {S: imageUrl}
                            },
                            Key: {
                              'uid': {S: image.hash}
                            },
                            UpdateExpression: "SET #tags = :tags, SET #uid = :uid, SET #url = :url",
                            TableName: 'picturebase'
                          }).then((data) => {
                            uploadBar.update(maxNewUploads, ++totalUploaded);
                            if (totalUploaded === maxNewUploads) {
                              resolve();
                            }
                          }).catch((err) => {
                            throw err;
                          });
                        }).catch((err) => {
                          throw err;
                        })
                      }
                    }).then(() => {
                      console.log('\nImages pushed');
                    }).catch((err) => {
                      throw err;
                    });
                  }
                }).catch(() => {
                });
              } else {
                if (options.push && newToSync.length > 0) {
                  console.log('\nPushing new images...');
                  totalUploaded = 0;
                  uploadBar.update(maxNewUploads, totalUploaded);
  
                  new Promise((resolve, reject) => {
                    for (let i = 0; i < maxNewUploads; i++) {
                      const image = newToSync[i];
                      const imageUrl = image.hash + image.localCopies[0].substr(image.localCopies[0].lastIndexOf('.'));

                      s3Upload.push(image.localCopies[0], imageUrl).then((details) => {
                        dynamodb.updateItem({
                          ExpressionAttributeNames: {
                            '#tags': 'tags',
                            '#url': 'url'
                          },
                          ExpressionAttributeValues: {
                            ':tags': {SS: image.tags},
                            ':url': {S: imageUrl}
                          },
                          Key: {
                            'uid': {S: image.hash}
                          },
                          UpdateExpression: "SET #tags = :tags, #url = :url",
                          TableName: 'picturebase'
                        }).then((data) => {
                          uploadBar.update(maxNewUploads, ++totalUploaded);
                          if (totalUploaded === maxNewUploads) {
                            resolve();
                          }
                        }).catch((err) => {
                          throw err;
                        });
                      }).catch((err) => {
                        throw err;
                      })
                    }
                  }).then(() => {
                    console.log('\nImages pushed');
                  }).catch(() => {
                  });
                }
              }
/*
              
              console.log('Syncing new images...');
              totalUploaded = 0;
              uploadBar.lastLength = 0;

              let interval = setInterval(() => {
                uploadBar.update(localStore.size, totalUploaded);
                if (localStore.size === totalUploaded) {
                  clearInterval(interval);
                }

                totalUploaded++;
              }, 5);
*/
            }
          });

        }).catch((err) => {
          console.log(err);
        });  
      }).catch((err) => {
        console.log(err);
      });
    });
    
/*
    console.log('Uploading new images...');
    allImages.forEach((image) => {
      const uploadStream = UploadStream.upload({Bucket: 'i.bobco.moe', Key: `${uid}.${image.ext}`, ACL: 'public-read'});

      uploadStream.once('uploaded', (details) => {
        const item = {
          uid: {S: uid},
          tags: {SS: image.tags},
          url: {S: `${uid}.${image.ext}`}
        }
    
        dynamodbWestTwo.putItem({
          Item: item,
          TableName: 'picturebase'
        }, (err, data) => {
          if (err) {
            console.log(err);
          } else {
            console.log(`Uploaded successful, UID: ${uid}`);
          }
        });
      });

      fs.createReadStream(copies[0].uri)
      .pipe(uploadStream);
    });*/
  });
}

function compareTags(imageOne, imageTwo) {
  for (let i = 0; i < imageOne.tags.length; i++) {
    if (!imageTwo.tags.includes(imageOne.tags[i])) {
      return true;
    }
  }
  return false;
}

class progressBar{
  constructor(barLength=20) {
    this.barLength = barLength;
    this.lastLength = 0;
  }

  update(total, finished) {
    const percentComplete = finished/total;
    const bars = Math.floor(percentComplete*this.barLength);
    let bar = '=>';

    if (percentComplete === 1) {
      bar = '=='
    }
    for (let i = 0; i < this.barLength; i++) {
      if (i < bars) {
        bar = '=' + bar;
      } else {
        bar += ' ';
      }
    }

    let uploadProcess = `[${bar}] [${(percentComplete*100).toFixed(2)}%] ${finished}/${total}`;
    
    for (let i = 0; i < this.lastLength; i++) {
      uploadProcess = '\b' + uploadProcess;
    }
    this.lastLength = uploadProcess.length-this.lastLength;
    process.stdout.write(uploadProcess);
  }
}

class Directory extends EventEmitter {
  constructor(name, uri=name) {
    super();

    this.name = name;
    this.uri = uri;
    this.directories = new Map();
    this.images = new Map();
    this.bigImages = [];
    this.processing = [];
    this.ready = false;

    // Process contents (directories and images only)
    readdir(uri).then((dirContents) => {
      dirContents.forEach((itemName) => {
        const imageRegex = /.+((\.png)|(\.gif)|(\.jpg)|(\.jpeg))$/gi;
        const itemStat = fs.statSync(`${this.uri}/${itemName}`);

        if (itemStat.isFile() && imageRegex.test(itemName)) {
          if (itemStat.size < 8000000) {
            this.addImage(itemName);
          } else {
            this.bigImages.push([itemName, itemStat.size]);
          }
        } else if (itemStat.isDirectory()) {
          this.addDirectory(itemName);
        }
      });

      this.directories.forEach((dir) => {
        if (!dir.ready) {
          dir.once('ready', (directory) => {
            this.processing.splice(this.processing.indexOf(directory.name), 1);
            if (this.processing.length === 0) {
              this.emit('ready', this);
            }
          });
        } else {
          this.processing.splice(this.processing.indexOf(dir.name), 1);
        }
      });

      if (this.processing.length === 0) {
        this.emit('ready', this);
      }
    }).catch((err) => {
      console.log(err);
    });

    this.once('ready', () => {
      this.ready = true;
    })
  }

  addDirectory(name) {
    this.directories.set(name, new Directory(name, `${this.uri}/${name}`));
    this.processing.push(name);
  }

  addImage(name) {
    const image = new Image(`${this.uri}/${name}`, {tags: [this.name]});
    if (!this.images.has(image.hash)) {
      this.images.set(image.hash, image);
    } else {
      this.images.get(image.hash).localCopies.push(`${this.uri}/${name}`);
    }
  }
}

class Image {
  constructor(uri, {tags=[], hash=undefined}) {
    this.localCopies = [];
    this.remoteCopies = [];
    this.tags = tags;
    
    if (uri.startsWith('http')) {
      this.remoteCopies.push(uri);
    } else {
      this.localCopies.push(uri);
    }

    if (hash === undefined) {
      if (!uri.startsWith('http')) {
        const hash = crypto.createHash('md5');
        this.hash = hash.update(fs.readFileSync(uri)).digest('hex');
      }
    } else {
      this.hash = hash;
    }
  }
}

class ImageFromAws extends Image {
  constructor(awsItem) {
    super(`http://i.bobco.moe/${awsItem.url.S}`, {tags: awsItem.tags.SS, hash: awsItem.uid.S});
  }
}

// Run program
program.parse(process.argv);