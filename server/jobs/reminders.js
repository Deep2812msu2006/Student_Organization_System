import {readConfig} from '../config/env.js';
import {createDatabase} from '../config/db.js';
import {runReminders,previewMail} from '../services/community.service.js';
const database=createDatabase(readConfig());
try { console.log(await runReminders(database.pool,Number(process.env.REMINDER_DAYS||14)));console.log(await previewMail(database.pool)); }
finally {await database.pool.end();}
