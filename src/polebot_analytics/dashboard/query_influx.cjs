const { InfluxDB } = require('@influxdata/influxdb-client');
const url = 'http://localhost:8086';
const token = 'O6KdiXqBpyFcH1PlGx2GkVWjaUz6ptHEdA7nAwZsGA-DtC_un7iuWinrxczOF79ss1cb5ItgvqLjjRyaKDNXLQ==';
const org = '2fb3ec77104ac02e';
const queryApi = new InfluxDB({ url, token }).getQueryApi(org);
const query = `from(bucket: "polebot_data") |> range(start: -5m) |> filter(fn: (r) => r._measurement == "telemetry") |> limit(n: 5)`;
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
