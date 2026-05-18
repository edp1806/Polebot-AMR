const { InfluxDB } = require('@influxdata/influxdb-client');
const url = 'http://localhost:8086';
const token = 'admin_token';
const org = 'polebot_org';
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
