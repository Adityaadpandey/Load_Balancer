import express from 'express';
import os from 'os';

export const app = express();


// Generate a unique ID for this instance
export const instanceId = Math.random().toString(36).slice(2, 8).toUpperCase();
export const startedAt = new Date().toISOString();

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    instanceId,
    startedAt,
    hostname: os.hostname(),
  });
});


app.get("/serious", (req, res) => {
  let sum = 0;
  for (let index = 0; index < 10000000000; index++) {
    sum += index;

  }
  res.json({sum:sum , res: "This is a serious endpoint!"});
});
