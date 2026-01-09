import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 1,
  duration: '5s',
  thresholds: {
    // Ensure that the service availability is at least 99.9%
    'http_req_failed': ['rate<=0.001'], // 0.1% failure rate corresponds to 99.9% availability
  },
};

export default function () {
  const res = http.get('http://example-service.default.svc.cluster.local:80');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
