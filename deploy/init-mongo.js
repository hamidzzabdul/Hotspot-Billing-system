try {
  rs.status();
} catch (error) {
  if (error.code !== 94) throw error;
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
}
let primary = false;
for (let i = 0; i < 90; i++) {
  if (db.hello().isWritablePrimary) {
    primary = true;
    break;
  }
  sleep(1000);
}
if (!primary) throw new Error('Replica set did not become primary');
const appdb = db.getSiblingDB('wifex');
if (!appdb.getUser('wifex'))
  appdb.createUser({
    user: 'wifex',
    pwd: process.env.MONGO_APP_PASSWORD,
    roles: [{ role: 'readWrite', db: 'wifex' }],
  });
