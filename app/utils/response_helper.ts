import type { HttpContext } from '@adonisjs/core/http'

export default class ResponseHelper {
  public static success(
    response: HttpContext['response'],
    message: string,
    data: any = null,
    statusCode: number = 200,
    flag: boolean = false
  ) {
    if (flag) {
      return response.status(statusCode).json({
        message,
        ...data,
        timestamp: new Date().toISOString(),
      })
    } else {
      return response.status(statusCode).json({
        message,
        data,
        timestamp: new Date().toISOString(),
      })
    }
  }

  public static created(response: HttpContext['response'], message: string, data: any = null) {
    return this.success(response, message, data, 201)
  }

  public static error(
    response: HttpContext['response'],
    message: string,
    errors: any = null,
    statusCode: number = 400
  ) {
    return response.status(statusCode).json({
      message,
      errors,
      timestamp: new Date().toISOString(),
    })
  }

  public static badRequest(response: HttpContext['response'], message: string, errors: any = null) {
    return this.error(response, message, errors, 400)
  }

  public static unauthorized(
    response: HttpContext['response'],
    message: string = 'Unauthorized',
    errors: any = null
  ) {
    return this.error(response, message, errors, 401)
  }

  public static forbidden(response: HttpContext['response'], message: string, errors: any = null) {
    return this.error(response, message, errors, 403)
  }

  public static notFound(
    response: HttpContext['response'],
    message: string = 'Resource not found',
    errors: any = null
  ) {
    return this.error(response, message, errors, 404)
  }

  public static validationError(response: HttpContext['response'], message: string, errors: any) {
    return this.error(response, message, errors, 422)
  }

  public static serverError(
    response: HttpContext['response'],
    message: string = 'Internal Server Error',
    errors: any
  ) {
    return this.error(response, message, errors, 500)
  }

  public static paginated(
    response: HttpContext['response'],
    message: string,
    data: any,
    pagination: {
      currentPage: number
      perPage: number
      total: number
      lastPage: number
    }
  ) {
    return response.ok({
      success: true,
      message,
      data,
      pagination,
      timestamp: new Date().toISOString(),
    })
  }

  public static custom(
    response: HttpContext['response'],
    statusCode: number,
    message: string,
    data: any = null,
    success: boolean = true
  ) {
    return response.status(statusCode).json({
      success,
      message,
      data,
      timestamp: new Date().toISOString(),
    })
  }
}
