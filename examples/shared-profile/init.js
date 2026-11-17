#!/usr/bin/env node
import { initializeSharedProfile } from './fixture.js';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === '--help') {
  console.log('Usage: node examples/shared-profile/init.js /absolute/NEW-directory\nCreates fictional data in one SQLite database with two distinct assistant configs.\nGrants expire after 24 hours. Existing directories are never overwritten.');
  if (args[0] !== '--help') process.exitCode = 2;
} else {
  try { console.log(JSON.stringify(initializeSharedProfile(args[0]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
