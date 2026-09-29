import { Global, Module } from '@nestjs/common';
import { RolePermissionsService } from './role-permissions.service';

@Global()
@Module({
  providers: [RolePermissionsService],
  exports: [RolePermissionsService],
})
export class RolePermissionsModule {}
