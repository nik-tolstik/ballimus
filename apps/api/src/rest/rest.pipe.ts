import {
  Injectable,
  ValidationPipe,
  type ArgumentMetadata,
  type PipeTransform,
  type Type,
} from "@nestjs/common";

import { restRequestError, toRestHttpException } from "./rest.errors.js";

@Injectable()
export class PositiveBigIntPipe implements PipeTransform<string, bigint> {
  public transform(value: string, _metadata: ArgumentMetadata): bigint {
    if (!/^[1-9]\d*$/u.test(value)) {
      throw toRestHttpException(restRequestError(400, "IDENTIFIER_INVALID", "Identifiers must be positive decimal strings."));
    }
    try {
      return BigInt(value);
    } catch {
      throw toRestHttpException(restRequestError(400, "IDENTIFIER_INVALID", "Identifiers must be valid decimal strings."));
    }
  }
}

/** Applies DTO transformation and validation when runtime decorator metadata is unavailable. */
export class RestQueryPipe<T extends object> implements PipeTransform<unknown, Promise<T>> {
  private readonly validationPipe = new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

  public constructor(private readonly dto: Type<T>) {}

  public async transform(value: unknown, metadata: ArgumentMetadata): Promise<T> {
    return (await this.validationPipe.transform(value, {
      ...metadata,
      metatype: this.dto,
    })) as T;
  }
}
