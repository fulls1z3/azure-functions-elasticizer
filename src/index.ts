// libs
import { Promise as bluebird } from 'bluebird';
import * as _ from 'lodash';
import * as elasticsearch from 'elasticsearch';
import { ErrorType, HttpRequest, HttpStatusCode } from 'azure-functions-ts-essentials';
import { NameList } from 'elasticsearch';

/**
 * Elasticsearch configuration
 */
export const ELASTICSEARCH_REFRESH = 'wait_for';
export const ELASTICSEARCH_MAX_RESULTS = 2147483519;

/**
 * Instantiates and returns an elasticsearch client.
 */
export const getElasticClient = (host: string) => new elasticsearch.Client({
  host,
  defer: () => bluebird.defer()
});

/**
 * Shorthand returning the string representation of the date for day-based indexing.
 */
export const getStringDate = (now?: Date) => {
  if (!now)
    now = new Date();

  const year = now.getUTCFullYear();
  let month: string = (now.getUTCMonth() + 1).toString();
  let day: string = now.getUTCDate().toString();

  month = `${Number(month) < 10 ? '0' : ''}${month}`;
  day = `${Number(day) < 10 ? '0' : ''}${day}`;

  return `${year}.${month}.${day}`;
};

const getErrorResponse = (err: Array<any> | any) => {
  if (Array.isArray(err) && err.length > 0)
    return {
      status: HttpStatusCode.BadRequest,
      body: err.map(cur => ({
        type: _.get(cur, 'type'),
        message: _.get(cur, 'reason'),
        index: _.get(cur, 'index'),
        uuid: _.get(cur, 'index_uuid')
      }))
    };

  return {
    status: err.status,
    body: {
      type: err.displayName,
      message: err.message
    }
  };
};

/**
 * The elasticsearch-based RESTful API implementation.
 */
export class Elasticizer {
  private client: any;
  private refresh: string;
  private prefix: string;

  constructor(private readonly host: string,
              private readonly type: string,
              private readonly options?: {prefix?: string, refresh?: string}) {
    this.client = getElasticClient(host);

    this.refresh = _.get(options, 'refresh', ELASTICSEARCH_REFRESH);
    this.prefix = _.get(options, 'prefix', '');
  }

  /**
   * Retrieves an existing item by id.
   */
  getOne(index: string, id: any): Promise<any> {
    const query$ = this.client.get({
      index: `${this.prefix}${index}`,
      type: this.type,
      id
    });

    return query$
      .then((res: any) => ({
        status: HttpStatusCode.OK,
        body: {
          _index: res._index,
          _id: res._id,
          ...res._source
        }
      }))
      .catch(getErrorResponse);
  }

  /**
   * Retrieves existing items.
   */
  search(index: NameList,
         body?: any,
         query?: any,
         page?: number,
         perPage?: number,
         sortAsc?: boolean): Promise<any> {
    const query$ = this.client.search({
      index: Array.isArray(index)
        ? index.map(cur => `${this.prefix}${cur}`)
        : `${this.prefix}${index}`,
      body,
      q: query,
      from: Number(page) >= 0 && Number(perPage) > 0 ? Number(page) * Number(perPage) : 0,
      size: Number(perPage) > 0 ? Number(perPage) : ELASTICSEARCH_MAX_RESULTS,
      sort: `createdAtUtc:${sortAsc ? 'asc' : 'desc'}`
    });

    return query$
      .then((res: any) => ({
        status: HttpStatusCode.OK,
        body: {
          data: res.hits.hits.map((cur: any) => ({
            _index: cur._index,
            _id: cur._id,
            ...cur._source
          })),
          hasMore: Number(page) >= 0 && Number(perPage) > 0
            ? res.hits.total > (Number(page) + 1) * Number(perPage)
            : false,
          totalCount: res.hits.total
        }
      }))
      .catch(getErrorResponse);
  }

  /**
   * Inserts new items.
   */
  insertMany(req: HttpRequest): Promise<any> {
    const contentType = req.headers ? req.headers['content-type'] : undefined;

    if (!(contentType && contentType.indexOf('application/json') >= 0))
      return Promise.resolve({
        status: HttpStatusCode.BadRequest,
        body: {
          type: ErrorType.Invalid
        }
      });

    if (!(req.body && Object.keys(req.body).length))
      return Promise.resolve({
        status: HttpStatusCode.BadRequest,
        body: {
          type: ErrorType.Invalid
        }
      });

    const query$ = this.client.bulk({
      type: this.type,
      refresh: this.refresh,
      body: req.body.reduce((acc: any, cur: any) => {
        const index = {_index: `${this.prefix}${cur._index}`};
        delete cur._index;

        acc.push({index: {...index}}, {
          ...cur,
          createdAtUtc: new Date().toISOString()
        });

        return acc;
      }, [])
    });

    return query$
      .then((res: any) => {
        const isError = _.get(res, 'errors');

        if (isError)
          return getErrorResponse(res.items.map((cur: any) => cur.index.error));

        return {
          status: HttpStatusCode.Created,
          body: {}
        };
      })
      .catch(getErrorResponse);
  }

  /**
   * Updates (patches) an existing item.
   */
  updateOne(index: string, req: HttpRequest, id: any): Promise<any> {
    const contentType = req.headers ? req.headers['content-type'] : undefined;

    if (!(contentType && contentType.indexOf('application/json') >= 0))
      return Promise.resolve({
        status: HttpStatusCode.BadRequest,
        body: {
          type: ErrorType.Invalid
        }
      });

    if (!(req.body && Object.keys(req.body).length))
      return Promise.resolve({
        status: HttpStatusCode.BadRequest,
        body: {
          type: ErrorType.Invalid
        }
      });

    if (!id)
      return Promise.resolve({
        status: HttpStatusCode.BadRequest,
        body: {
          type: ErrorType.Invalid
        }
      });

    delete req.body._index;

    const query$ = this.client.update({
      index: `${this.prefix}${index}`,
      type: this.type,
      refresh: this.refresh,
      id,
      body: {
        doc: req.body
      }
    });

    return query$
      .then(() => ({
        status: HttpStatusCode.OK,
        body: {}
      }))
      .catch(getErrorResponse);
  }

  /**
   * Deletes an existing item.
   */
  deleteOne(index: any, id: any): Promise<any> {
    if (!id)
      return Promise.resolve({
        status: HttpStatusCode.BadRequest,
        body: {
          type: ErrorType.Missing
        }
      });

    const query$ = this.client.delete({
      index: `${this.prefix}${index}`,
      type: this.type,
      refresh: this.refresh,
      id
    });

    return query$
      .then(() => ({
        status: HttpStatusCode.OK,
        body: {}
      }))
      .catch(getErrorResponse);
  }
}
