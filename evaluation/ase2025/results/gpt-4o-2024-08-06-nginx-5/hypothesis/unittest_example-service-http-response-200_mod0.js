import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 5,
  duration: '5s',
  thresholds: {
    // Adding a threshold to ensure that at least 95% of requests return a status code 200
    'http_req_failed': ['rate<0.05'], // Less than 5% of requests should fail
  },
};

export default function () {
  const res = http.get('http://example-service.default.svc.cluster.local:80');
  check(res, {
    'is status 200': (r) => r.status === 200,
  });
}