const { InfluxDB } = require('@influxdata/influxdb-client');
const url = 'http://localhost:8086';
const token = 'O6KdiXqBpyFcH1PlGx2GkVWjaUz6ptHEdA7nAwZsGA-DtC_un7iuWinrxczOF79ss1cb5ItgvqLjjRyaKDNXLQ==';
const org = '2fb3ec77104ac02e';
const queryApi = new InfluxDB({ url, token }).getQueryApi(org);

const startRange = '-24h';
const selectedRobotId = 'polebot_01';
const influxBucket = 'polebot_data';

const query = `
    from(bucket: "${influxBucket}")
      |> range(start: ${startRange})
      |> filter(fn: (r) => r._measurement == "telemetry")
      |> filter(fn: (r) => r["robot_id"] == "${selectedRobotId}")
      |> filter(fn: (r) => r._field != "estop_active")
      |> aggregateWindow(every: 30s, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  `;

queryApi.queryRows(query, {
  next(row, tableMeta) {
    console.log(tableMeta.toObject(row));
  },
  error(error) {
    console.error(error);
  },
  complete() {
    console.log('\nFinished query');
  },
});
