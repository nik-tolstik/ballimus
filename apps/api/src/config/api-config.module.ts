import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";

import {
  API_CONFIG,
  API_CONFIG_NAMESPACE,
  apiConfiguration,
  parseApiConfig,
  validateApiEnvironment,
  type ApiConfig,
} from "./api-config.js";

export const API_CONFIG_PROVIDER = {
  provide: API_CONFIG,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): ApiConfig =>
    configService.getOrThrow<ApiConfig>(API_CONFIG_NAMESPACE),
};

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      load: [apiConfiguration],
      validate: validateApiEnvironment,
    }),
  ],
  providers: [API_CONFIG_PROVIDER],
  exports: [ConfigModule, API_CONFIG_PROVIDER],
})
export class ApiConfigModule {}

export { ConfigService } from "@nestjs/config";
export {
  API_CONFIG,
  API_CONFIG_NAMESPACE,
  apiConfiguration,
  parseApiConfig,
  validateApiEnvironment,
};
export type { ApiConfig } from "./api-config.js";
