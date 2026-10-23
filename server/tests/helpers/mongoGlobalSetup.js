import { MongoMemoryServer } from 'mongodb-memory-server';

/** One mongod for the whole run; each test file uses its own database. */
export default async function setup({ provide }) {
  const mongod = await MongoMemoryServer.create();
  provide('mongoUri', mongod.getUri());
  return async () => mongod.stop();
}
