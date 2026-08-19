import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MrnRegistry, MrnRegistrySchema } from './mrn-registry.model';
import { MrnService } from './mrn.service';

/**
 * Self-contained on purpose: it registers its own model rather than depending on
 * UsersModule/DoctorsModule exporting theirs, so it can be imported anywhere without
 * creating a module cycle.
 *
 * It no longer needs the User/Doctor models at all — allocation goes through the
 * registry, so the service touches exactly one collection.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: MrnRegistry.name, schema: MrnRegistrySchema },
        ]),
    ],
    providers: [MrnService],
    exports: [MrnService],
})
export class MrnModule { }
