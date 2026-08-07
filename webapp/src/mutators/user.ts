import { RecordService } from 'pocketbase';
import { type User, type UserInput, UserInputSchema } from '../schema/user';
import type { TypedPocketBase } from '../types';
import { BaseMutator } from './base';

export class UserMutator extends BaseMutator<User, UserInput> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection(): RecordService<User> {
    return this.pb.collection('Users');
  }

  protected async validateInput(input: UserInput): Promise<UserInput> {
    // Validate the input using the schema
    const validated = UserInputSchema.parse(input);
    // Return without passwordConfirm for database operations (it's only for validation)
    const { passwordConfirm, ...result } = validated;
    // passwordConfirm is only used for validation, not stored in database
    void passwordConfirm;
    return result as UserInput;
  }
}
