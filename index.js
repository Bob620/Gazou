const fs = require('fs'),
      util = require('util'),
      EventEmitter = require('events'),
      crypto = require('crypto');

const aws = require('aws-sdk'),
      kagi = require('kagi');
      aws.config.update(kagi.getChain('kagi.chn').getLink('credentials'));
      program = require('commander');

const DynamoDB = require('./DynamoDB.js'),
      S3Upload = require('./S3Upload.js'),
      Timing = require('./Timing.js');

const readdir = util.promisify(fs.readdir),
      dynamodb = new DynamoDB(),
      s3Upload = new S3Upload();

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

// Compares images to find and add new ones, or add new tags to old images
function addNewImages(dir, allImages) {
  dir.images.forEach((image) => {
//    timing.setNow('imageStartTime');
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
//    timing.setRelative('returnTime', 'imageStartTime');
  });
}

function processDir(directory, options) {
  console.log('Processing Directory...\n');
  const timing = new Timing();
  // Discover all Directories and Images
  let rootDirectory = new Directory(directory);

  // Discovered
  rootDirectory.once('ready', () => {
    timing.setNow('discovered');
    console.log(`All images discovered in ${timing.getDiff('baseTime', 'discovered')} sec\nchecking images for dups...`);

    let allImages = new Map();

    // Compare images in the main directory
    addNewImages(rootDirectory, allImages);

    // Compare each sub-directory's images
    rootDirectory.directories.forEach((dir) => {
      addNewImages(dir, allImages);
    });

    // Find the total number of copies (Images with more then one tag) and original images
    let totalImages = 0;
    let copies = 0;

    allImages.forEach((image) => {
      const occurance = image.localCopies.length;
      totalImages += occurance;
      if (occurance > 1) {
        copies += occurance-1;
      }
    });

    /**
     * Begin helpful info
     */

    timing.setNow('finishedComparing');

    console.log(`Images compared in ${timing.getDiff('discovered', 'finishedComparing')} sec\n`);
    console.log(`Found ${copies} copies.\n`);
    console.log(`Total images found: ${totalImages}`);
    console.log(`Unique images found: ${allImages.size}\n`);
    console.log(`Total time to load and compare: ${process.uptime() - timing.baseTime} sec\n`);
    
    // Display the images that do not fit size requirements
    let bigImages = rootDirectory.bigImages;
    
    rootDirectory.directories.forEach((directory) => {
      bigImages = bigImages.concat(directory.bigImages);
    });

    console.log(`Found ${bigImages.length} images over 8MB (Max discord upload size)\n`);
    bigImages.forEach((image) => {
      console.log(image);
    });

    /**
     * End of helpful info
     */

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
      timing.setNow('downloadStart');

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

        Promise.all(imagePromises).then(async () => {
          console.log(`Downloaded remote store containing ${remoteStore.size} images`);
          console.log(`Remote images retrived in ${process.uptime() - timing.get('downloadStart')} secs\n`);
          console.log('Comparing local and remote stores\n');
  
          timing.setNow('remoteCompareStart');
  
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

          console.log(`Remote compared in ${process.uptime() - timing.get('remoteCompareStart')} secs\n`);
          console.log(`Found ${remoteCopies} copies.`);
//          console.log(`Found ${remoteUpdates} new images.`);
          console.log(`Found ${newToSync.length} new local images to sync`);
          console.log(`Found ${diffToSync.length} local images to sync for new tags`);

//          console.log(`Unique images found: ${localStore.size}\n`);
          
          // Abstract this section

          // Writes a file for the local store
          // Handle a better way
          fs.writeFileSync(`${directory}/localStore.json`, JSON.stringify([...localStore]));
          
          console.log('Local store updated\n');
          console.log(`Full scan, comparison, and update completed in ${process.uptime() - timing.baseTime} sec\n`);

          // Find the max number of new items to upload
          let maxNewUploads = options.max < newToSync.length ? options.max : newToSync.length;

          // UPDATE OLD FILES
          // Updates all of old files or none of them
          if (options.update && diffToSync.length > 0) {
            console.log('Updating old images...');
            
            // Init progress bar
            let totalUploaded = 0;
            const uploadBar = new progressBar({total: diffToSync.length});
            uploadBar.update(0);

            // Sync all the images for differences
            for (let i = 0; i < diffToSync.length; i++) {
              pushUpdate(diffToSync[i]).then(({remoteImage}) => {
                uploadBar.update(++totalUploaded);
              });
            }
          }

          // Uploads max number of new items
          if (options.push && newToSync.length > 0) {
            console.log('Pushing new images...');
            
            // Init progress bar
            let totalUploaded = 0;
            const uploadBar = new progressBar({total: maxNewUploads});
            uploadBar.update(0);

            // Iterate over all the objects needingto be uploaded
            for (let i = 0; i < maxNewUploads; i++) {
              // Find the image to upload
              uploadImage(newToSync[i]).then(({s3Details, remoteImage}) => {
                uploadBar.update(++totalUploaded);
              });
            }
          }
        }).catch((err) => {
          console.log(err);
        });  
      }).catch((err) => {
        console.log(err);
      });
    });
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

// Uploads a single image
async function uploadImage({hash: imageHash, localCopies, tags}) {
  // Get image name (imageHash + extention of original image)
  // Currently uses the first local copy found
  // Can we prefer .png over .jpg/.jpeg, vice versa?
  // Technically they are the same image down to every bit because we checked
  const localCopy = localCopies[0];
  const imageUrl = imageHash + localCopy.substr(localCopy.lastIndexOf('.')).toLowerCase();

  // Upload image to s3
  const s3Details = await s3Upload.push(localCopy, imageUrl);  
  // Upload image link to dynamodb
  const remoteImage = await dynamodb.updateItem({
    ExpressionAttributeNames: {
      '#tags': 'tags',
      '#url': 'url'
    },
    ExpressionAttributeValues: {
      ':tags': {SS: tags},
      ':url': {S: imageUrl}
    },
    Key: {
      'uid': {S: imageHash}
    },
    UpdateExpression: "SET #tags = :tags, #url = :url",
    TableName: 'picturebase'
  });
  // Return something
  return {s3Details, remoteImage};
}

// Updates a single image's dynamodb entry 
async function pushUpdate({hash: imageHash, tags}) {
  // Only a hash is needed to update the image link
  // Once uploaded you can't modify the image it points at (the url)
  const remoteImage = await dynamodb.updateItem({
    ExpressionAttributeNames: {
      '#tags': 'tags'
    },
    ExpressionAttributeValues: {
      ':tags': {SS: tags}
    },
    Key: {
      'uid': {S: imageHash}
    },
    UpdateExpression: "SET #tags = :tags",
    TableName: 'picturebase'
  });
  // Return something
  return {remoteImage};
}

class progressBar {
  constructor({barLength=20, total=100}) {
    this.total = total;
    this.barLength = barLength;
    this.lastLength = 0;
  }

  update(finished) {
    const percentComplete = finished/this.total;
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

    let uploadProcess = `[${bar}] [${(percentComplete*100).toFixed(2)}%] ${finished}/${this.total}`;
    
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