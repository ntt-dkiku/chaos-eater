import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 1,
  duration: '5s',
  thresholds: {
    // Define a threshold for the success rate of HTTP requests
    'http_req_failed': ['rate<=0.01'], // This ensures that the failure rate is 1% or less, meaning the success rate is 99% or more
  },
};

export default function () {
  const res = http.get('http://example-service.default.svc.cluster.local:80');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
