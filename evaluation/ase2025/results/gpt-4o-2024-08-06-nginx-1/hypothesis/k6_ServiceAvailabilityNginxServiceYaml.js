import http from 'k6/http';
import { check } from 'k6';

export let options = {
  vus: 10,
  duration: '5s',
};

export default function () {
  let res = http.get('http://example-service.default.svc.cluster.local:80');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
