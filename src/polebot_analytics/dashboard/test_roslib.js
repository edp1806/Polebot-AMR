import * as ROSLIB from 'roslib';
console.log("ROSLIB:", Object.keys(ROSLIB));
console.log("Has Message?", 'Message' in ROSLIB);
console.log("Has default.Message?", ROSLIB.default && 'Message' in ROSLIB.default);
