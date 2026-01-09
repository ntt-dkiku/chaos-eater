import http from 'k6/http';
import { check } from 'k6';

export let options = {
  vus: 10,
  duration: '5s',
  thresholds: {
    'http_req_failed': ['rate<0.005'], // Allowing for a 0.5% failure rate
    'http_req_duration': ['p(95)<200'], // Optional: 95% of requests should be below 200ms
  },
};

export default function () {
  let res = http.get('http://example-service.default.svc.cluster.local:80');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}