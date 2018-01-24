// libs
import { Promise as bluebird } from 'bluebird';
import * as _ from 'lodash';
import { Context, HttpMethod, HttpRequest, HttpResponse, HttpStatusCode } from 'azure-functions-ts-essentials';

// module
import { Elasticizer, ELASTICSEARCH_REFRESH, getElasticClient, getStringDate } from './index';

global.Promise = bluebird;

const ELASTICSEARCH_HOST = 'http://localhost:9200';
const ELASTICSEARCH_INDEX_PREFIX = 'testing.';

const TEST_INDEX = 'testlogs';
const TEST_TYPE = 'testType';

let TEST_ID: string;
const INITIAL_ITEMS = [
  {
    _index: TEST_INDEX,
    code: 'CODE',
    name: 'name'
  },
  {
    _index: TEST_INDEX,
    code: 'ANOTHER CODE',
    name: 'another name'
  }
];
const POST_VALUE = [
  {
    _index: TEST_INDEX,
    code: 'NEW CODE',
    name: 'new name'
  }
];
const PATCH_VALUE = {
  _index: TEST_INDEX,
  code: 'SOME CODE'
};

const INVALID_ID = 'INVALID_ID';
const INVALID_VALUE = [
  {
    _index: 'TeStInG',
    code: 'NEW CODE',
    name: 'new name'
  }
];

const mock = (context: Context, req: HttpRequest): any => {
  const elasticizer = new Elasticizer(ELASTICSEARCH_HOST, TEST_TYPE, {prefix: ELASTICSEARCH_INDEX_PREFIX});

  let res$: Promise<HttpResponse>;
  const method = _.get(req, 'method');
  const index = _.get(req, 'params.index', '');
  const id = _.get(req, 'params.id');

  switch (method) {
    case HttpMethod.Get:
      const body = _.get(req.query, 'body');
      const query = _.get(req.query, 'q');
      const page = _.get(req.query, 'page', 0);
      const perPage = _.get(req.query, 'per_page', 10000);
      const sort = _.get(req.query, 'sortAsc', false);

      res$ = id
        ? elasticizer.getOne(index, id)
        : elasticizer.search(index, body, query, page, perPage, sort);
      break;
    case HttpMethod.Post:
      res$ = elasticizer.insertMany(req);
      break;
    case HttpMethod.Patch:
      res$ = elasticizer.updateOne(index, req, id);
      break;
    case HttpMethod.Delete:
      res$ = elasticizer.deleteOne(index, id);
      break;
    default:
      res$ = Promise.resolve({
        status: HttpStatusCode.MethodNotAllowed,
        body: {
          error: {
            type: 'not_supported',
            message: `Method ${method} not supported.`
          }
        }
      });
  }

  res$
    .then(res => {
      context.done(undefined, res);
    })
    .catch((err: any) => {
      context.done(undefined, {
        status: HttpStatusCode.InternalServerError,
        body: {
          message: err.message
        }
      });
    });
};

describe('@azure-seed/azure-functions-elasticizer', () => {
  beforeAll(async () => {
    const client = getElasticClient(ELASTICSEARCH_HOST);

    await client.bulk({
      type: TEST_TYPE,
      refresh: ELASTICSEARCH_REFRESH,
      body: INITIAL_ITEMS.reduce((acc: any, cur: any) => {
        const index = {_index: `${ELASTICSEARCH_INDEX_PREFIX}${cur._index}`};
        delete cur._index;

        acc.push({index: {...index}}, {
          ...cur,
          createdAtUtc: new Date().toISOString()
        });

        return acc;
      }, [])
    });
  });

  afterAll(async () => {
    const client = getElasticClient(ELASTICSEARCH_HOST);

    await client.indices.delete({index: `${ELASTICSEARCH_INDEX_PREFIX}${TEST_INDEX}`});
  });

  describe('GET /api/mock-items/:index', () => {
    it('should be able to return a list of all items', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body).toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data)).toEqual('object');
          expect((response as HttpResponse).body.data.length).toEqual(2);
          expect((response as HttpResponse).body).toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore)).toEqual('boolean');
          expect((response as HttpResponse).body).toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount)).toEqual('number');

          TEST_ID = (response as HttpResponse).body.data[0]._id;

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Get,
        params: {
          index: TEST_INDEX
        }
      };

      mock(mockContext, mockRequest);
    });

    it('should be able to return a list of all items (multiple indices)', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body).toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data)).toEqual('object');
          expect((response as HttpResponse).body.data.length).toEqual(2);
          expect((response as HttpResponse).body).toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore)).toEqual('boolean');
          expect((response as HttpResponse).body).toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount)).toEqual('number');

          TEST_ID = (response as HttpResponse).body.data[0]._id;

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Get,
        params: {
          index: [TEST_INDEX]
        }
      };

      mock(mockContext, mockRequest);
    });

    it('should be able to return items w/query', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body).toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data)).toEqual('object');
          expect((response as HttpResponse).body.data.length).toEqual(1);
          expect((response as HttpResponse).body).toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore)).toEqual('boolean');
          expect((response as HttpResponse).body).toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount)).toEqual('number');

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Get,
        params: {
          index: TEST_INDEX
        },
        query: {
          q: 'code:ANOTHER',
          body: {
            query: {
              match: {
                code: 'ANOTHER'
              }
            }
          }
        }
      };

      mock(mockContext, mockRequest);
    });

    it('should be able to return items w/pagination', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body).toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data)).toEqual('object');
          expect((response as HttpResponse).body.data.length).toEqual(1);
          expect((response as HttpResponse).body).toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore)).toEqual('boolean');
          expect((response as HttpResponse).body).toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount)).toEqual('number');

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Get,
        params: {
          index: TEST_INDEX
        },
        query: {
          page: 0,
          per_page: 1
        }
      };

      mock(mockContext, mockRequest);
    });

    it('should be able to return items in ascending order', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body).toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data)).toEqual('object');
          expect((response as HttpResponse).body.data.length).toEqual(2);
          expect((response as HttpResponse).body).toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore)).toEqual('boolean');
          expect((response as HttpResponse).body).toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount)).toEqual('number');

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Get,
        params: {
          index: TEST_INDEX
        },
        query: {
          sortAsc: true
        }
      };

      mock(mockContext, mockRequest);
    });
  });

  describe('GET /api/mock-items/:index/:id', () => {
    it('should be able to return an object conforming the model', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body).toHaveProperty('_id');
          expect(typeof((response as HttpResponse).body._id)).toEqual('string');
          expect((response as HttpResponse).body).toHaveProperty('code');
          expect(typeof((response as HttpResponse).body.code)).toEqual('string');
          expect((response as HttpResponse).body).toHaveProperty('name');
          expect(typeof((response as HttpResponse).body.name)).toEqual('string');

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Get,
        params: {
          index: TEST_INDEX,
          id: TEST_ID
        }
      };

      mock(mockContext, mockRequest);
    });

    it('should be able to return an item', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body._id).toEqual(TEST_ID);
          expect((response as HttpResponse).body.code).toEqual(INITIAL_ITEMS[0].code);
          expect((response as HttpResponse).body.name).toEqual(INITIAL_ITEMS[0].name);

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Get,
        params: {
          index: TEST_INDEX,
          id: TEST_ID
        }
      };

      mock(mockContext, mockRequest);
    });

    it('should fail with 404 w/o an existing id', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.NotFound);

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Get,
        params: {
          index: TEST_INDEX,
          id: INVALID_ID
        }
      };

      mock(mockContext, mockRequest);
    });
  });

  describe('POST /api/mock-items', () => {
    it('should be able to create new items', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.Created);
          expect((response as HttpResponse).body).toEqual({});

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Post,
        headers: { 'content-type': 'application/json' },
        body: POST_VALUE
      };

      mock(mockContext, mockRequest);
    });

    it('should fail with 400 w/o `content-type` header', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Post
      };

      mock(mockContext, mockRequest);
    });

    it('should fail with 400 w/o request body', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Post,
        headers: { 'content-type': 'application/json' }
      };

      mock(mockContext, mockRequest);
    });

    it('should fail with 400 w/o valid index', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.BadRequest);
          expect((response as HttpResponse).body).toBeDefined();

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Post,
        headers: { 'content-type': 'application/json' },
        body: INVALID_VALUE
      };

      mock(mockContext, mockRequest);
    });
  });

  describe('PATCH /api/mock-items/:index/:id', () => {
    it('should be able to update an existing item', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body).toEqual({});

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Patch,
        headers: { 'content-type': 'application/json' },
        body: PATCH_VALUE,
        params: {
          index: TEST_INDEX,
          id: TEST_ID
        }
      };

      mock(mockContext, mockRequest);
    });

    it('should fail with 400 w/o `content-type` header', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Patch,
        body: PATCH_VALUE
      };

      mock(mockContext, mockRequest);
    });

    it('should fail with 400 w/o id', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Patch,
        headers: { 'content-type': 'application/json' },
        body: PATCH_VALUE
      };

      mock(mockContext, mockRequest);
    });

    it('should fail with 404 w/o an existing id', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.NotFound);

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Patch,
        headers: { 'content-type': 'application/json' },
        body: PATCH_VALUE,
        params: {
          index: TEST_INDEX,
          id: INVALID_ID
        }
      };

      mock(mockContext, mockRequest);
    });

    it('should fail with 400 w/o request body', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Patch,
        headers: { 'content-type': 'application/json' },
        params: {
          index: TEST_INDEX,
          id: INVALID_ID
        }
      };

      mock(mockContext, mockRequest);
    });
  });

  describe('DELETE /api/mock-items/:index/:id', () => {
    it('should be able to delete an existing item', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body).toEqual({});

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Delete,
        params: {
          index: TEST_INDEX,
          id: TEST_ID
        }
      };

      mock(mockContext, mockRequest);
    });

    it('should fail with 400 w/o id', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Delete
      };

      mock(mockContext, mockRequest);
    });

    it('should fail with 404 w/o an existing id', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.NotFound);

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: HttpMethod.Delete,
        params: {
          index: TEST_INDEX,
          id: INVALID_ID
        }
      };

      mock(mockContext, mockRequest);
    });
  });

  describe('XYZ /api/mock-items', () => {
    it('should fail with 405 w/any other Http method', (done: () => void) => {
      const mockContext: Context = {
        done: (err, response) => {
          expect(err).toBeUndefined();
          expect((response as HttpResponse).status).toEqual(HttpStatusCode.MethodNotAllowed);
          expect((response as HttpResponse).body).toEqual({
            error: {
              type: 'not_supported',
              message: 'Method XYZ not supported.'
            }
          });

          done();
        }
      };

      const mockRequest: HttpRequest = {
        method: 'XYZ' as HttpMethod
      };

      mock(mockContext, mockRequest);
    });
  });

  describe('getStringDate', () => {
    it('should be able to return the string dates', () => {
      const stringDate = getStringDate(new Date(0));
      expect(stringDate).toEqual('1970.01.01');

      const now1 = getStringDate(new Date());
      const now2 = getStringDate();

      expect(now1).toEqual(now2);
    });
  });
});
