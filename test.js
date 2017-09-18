items = [];

setTimeout(() => {
  const callback = items.shift();
  callback(undefined, 'test');
}, 1000);

function callBack({resolve, reject}, err, data) {
  if (err) {
    reject(err);
  } else {
    resolve(data);
  }
}

function putItem() {
  return new Promise((resolve, reject) => {
    items.push(callBack.bind(this, {resolve, reject}));
  });
}

async function test() {
  console.log(await putItem());
}

test();