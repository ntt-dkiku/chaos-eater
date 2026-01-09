import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 1,
  duration: '5s',
  thresholds: {
    // Ensure that the success rate for HTTP 200 responses is at least 95%
    'http_req_failed': ['rate<0.05'],
  },
};

export default function () {
  const res = http.get('http://example-service.default.svc.cluster.local:80');
  check(res, {
    'is status 200': (r) => r.status === 200,
  });
}