import { permissionMutations } from '../data/resolvers/mutations/permissions';
import { graphqlRequest } from '../db/connection';
import { permissionFactory, userFactory, usersGroupFactory } from '../db/factories';
import { Permissions, Users, UsersGroups } from '../db/models';
import { IUserGroup } from '../db/models/definitions/permissions';

describe('Test permissions mutations', () => {
  let _permission;
  let _user;
  let _group;
  let context;

  const doc = {
    actions: ['up', ' test'],
    allowed: true,
    module: 'module name',
  };

  beforeEach(async () => {
    // Creating test data
    _permission = await permissionFactory();
    _group = await usersGroupFactory();
    _user = await userFactory({ isOwner: true });

    context = { user: _user };
  });

  afterEach(async () => {
    // Clearing test data
    await Permissions.remove({});
    await UsersGroups.remove({});
    await Users.remove({});
  });

  test('Permission login required functions', async () => {
    const checkLogin = async (fn, args) => {
      try {
        await fn({}, args, {});
      } catch (e) {
        expect(e.message).toEqual('Login required');
      }
    };

    expect.assertions(2);

    // add permission
    checkLogin(permissionMutations.permissionsAdd, doc);

    // remove permission
    checkLogin(permissionMutations.permissionsRemove, { ids: [] });
  });

  test(`test if Error('Permission required') error is working as intended`, async () => {
    const checkLogin = async (fn, args) => {
      try {
        await fn({}, args, { user: { _id: 'fakeId' } });
      } catch (e) {
        expect(e.message).toEqual('Permission required');
      }
    };

    expect.assertions(2);

    // add permission
    checkLogin(permissionMutations.permissionsAdd, doc);

    // remove permission
    checkLogin(permissionMutations.permissionsRemove, { ids: [_permission._id] });
  });

  test('Create permission', async () => {
    const args = {
      module: 'module name',
      actions: ['manageBrands'],
      userIds: [_user._id],
      groupIds: [_group._id],
      allowed: true,
    };

    const mutation = `
      mutation permissionsAdd(
        $module: String!,
        $actions: [String!]!,
        $userIds: [String!],
        $groupIds: [String!],
        $allowed: Boolean
      ) {
        permissionsAdd(
          module: $module
          actions: $actions
          userIds: $userIds
          groupIds: $groupIds
          allowed: $allowed
        ) {
          _id
          module
          action
          userId
          groupId
          requiredActions
          allowed
        }
      }
    `;

    const [permission] = await graphqlRequest(mutation, 'permissionsAdd', args, context);

    expect(permission.module).toEqual('module name');
  });

  test('Remove permission', async () => {
    const ids = [_permission._id];

    const mutation = `
      mutation permissionsRemove($ids: [String]!) {
        permissionsRemove(ids: $ids)
      }
    `;

    await graphqlRequest(mutation, 'permissionsRemove', { ids }, context);

    expect(await Permissions.find({ _id: _permission._id })).toEqual([]);
  });

  test('Create group', async () => {
    const args = { name: 'created name', description: 'created description' };

    const mutation = `
      mutation usersGroupsAdd($name: String! $description: String!) {
        usersGroupsAdd(name: $name description: $description) {
          _id
          name
          description
        }
      }
    `;

    const createdGroup = await graphqlRequest(mutation, 'usersGroupsAdd', args, context);

    expect(createdGroup.name).toEqual('created name');
    expect(createdGroup.description).toEqual('created description');
  });

  test('Update group', async () => {
    const args: IUserGroup = { name: 'updated name', description: 'updated description' };

    const mutation = `
      mutation usersGroupsEdit($_id: String! $name: String! $description: String!) {
        usersGroupsEdit(_id: $_id name: $name description: $description) {
          _id
          name
          description
        }
      }
    `;

    const updatedGroup = await graphqlRequest(
      mutation,
      'usersGroupsEdit',
      { _id: _group._id, ...args },
      { user: _user },
    );

    expect(updatedGroup.name).toBe('updated name');
    expect(updatedGroup.description).toBe('updated description');
  });

  test('Remove group', async () => {
    const mutation = `
      mutation usersGroupsRemove($_id: String!) {
        usersGroupsRemove(_id: $_id)
      }
    `;

    await graphqlRequest(mutation, 'usersGroupsRemove', { _id: _group._id }, context);

    expect(await UsersGroups.findOne({ _id: _group._id })).toBe(null);
  });
});
