/*
Copyright 2019 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

const { Tvm } = require('../../../lib/Tvm')

const fakeParams = JSON.parse(JSON.stringify(global.baseNoErrorParams))

describe('processRequest (abstract)', () => {
  // setup
  /** @type {Tvm} */
  let tvm
  beforeEach(() => {
    tvm = new Tvm()
  })

  test('without implementation', async () => {
    const response = await tvm.processRequest(fakeParams)
    global.expectServerError(response, 'not implemented')
  })

  describe('with a mock implementation', () => {
    const mockResponse = {
      a: 'field',
      another: { important: { value: 1 } }
    }
    beforeEach(() => {
      tvm._generateCredentials = jest.fn()
      tvm._generateCredentials.mockResolvedValue(mockResponse)
    })

    describe('param validation', () => {
      test('when a non expected param is there', async () => global.testParam(tvm, fakeParams, 'non__expected__param', 'hello'))
      test('when a non expected param starts with `__ow*` (allowed)', async () => global.testParam(tvm, fakeParams, '__ow_param', 'hello', 200))
      test('when a non expected param has an empty key "", (allowed)', async () => global.testParam(tvm, fakeParams, '', 'hello', 200))

      test('when expirationDuration is missing', async () => global.testParam(tvm, fakeParams, 'expirationDuration', undefined))
      test('when expirationDuration is not parseInt string', async () => global.testParam(tvm, fakeParams, 'expirationDuration', 'hello'))

      test('when approvedList is missing', async () => global.testParam(tvm, fakeParams, 'approvedList', undefined))
      test('when approvedList is empty', async () => global.testParam(tvm, fakeParams, 'approvedList', ''))

      test('when owApihost is missing', async () => global.testParam(tvm, fakeParams, 'owApihost', undefined))
      test('when owApihost is not a valid uri', async () => global.testParam(tvm, fakeParams, 'owApihost', 'hello'))

      test('when owNamespace is missing', async () => global.testParam(tvm, fakeParams, 'owNamespace', undefined))
      test('when owNamespace is empty', async () => global.testParam(tvm, fakeParams, 'owNamespace', ''))
      test('when owNamespace is bigger than 63 chars', async () => global.testParam(tvm, fakeParams, 'owNamespace', 'a'.repeat(64)))
      test('when owNamespace is equal to 63 chars', async () => {
        const ns63chars = 'a'.repeat(63)
        global.owNsListMock.mockResolvedValue([ns63chars])
        await global.testParam(tvm, fakeParams, 'owNamespace', ns63chars, 200)
      })
      test('when owNamespace is smaller than 3 chars', async () => global.testParam(tvm, fakeParams, 'owNamespace', 'aa'))

      test('when authorization header is missing', async () => global.testParam(tvm, fakeParams, '__ow_headers.authorization', undefined, 401))
      test('when authorization header is empty', async () => global.testParam(tvm, fakeParams, '__ow_headers.authorization', '', 401))
    })

    describe('openwhisk namespace/auth validation', () => {
      test('when openwhisk.namespaces.list throws an error', async () => {
        const errorMsg = 'abfjdsjfhbv'
        global.owNsListMock.mockRejectedValue(new Error(errorMsg))
        const response = await tvm.processRequest(fakeParams)
        global.expectUnauthorized(response, errorMsg)
      })
      test('when openwhisk.namespaces.list returns with an empty list', async () => {
        global.owNsListMock.mockResolvedValue([])
        const response = await tvm.processRequest(fakeParams)
        global.expectUnauthorized(response, '[]')
      })
      test('when openwhisk.namespaces.list returns with a list not containing the namespace', async () => {
        global.owNsListMock.mockResolvedValue(['notinthelist', 'anotherNS'])
        const response = await tvm.processRequest(fakeParams)
        global.expectUnauthorized(response, '[notinthelist,anotherNS]')
      })
      test('when openwhisk.namespaces.list returns with a list containing only the namespace (authorized)', async () => {
        global.owNsListMock.mockResolvedValue([fakeParams.owNamespace])
        const response = await tvm.processRequest(fakeParams)
        expect(response.statusCode).toEqual(200)
      })
      test('when openwhisk.namespaces.list returns with a list containing the namespace and others (authorized)', async () => {
        global.owNsListMock.mockResolvedValue([fakeParams.owNamespace, 'otherNS', 'otherNS2'])
        const response = await tvm.processRequest(fakeParams)
        expect(response.statusCode).toEqual(200)
      })
    })

    describe('namespace approvedList validation', () => {
      const testApprovedList = async (approvedList, expectedAuthorized) => {
        const testParams = { ...fakeParams }
        testParams.approvedList = approvedList
        const response = await tvm.processRequest(testParams)
        if (expectedAuthorized) return expect(response.statusCode).toEqual(200)
        return global.expectUnauthorized(response, 'is not approved')
      }

      test('when approvedList contains only another namespace', async () => testApprovedList('anotherNS', false))
      test('when approvedList contains a list of different namespaces', async () => testApprovedList(',anotherNS, anotherNS2,anotherNS3 ,anotherNS4 ,', false))
      test('when approvedList contains a namespace which shares the same prefix', async () => testApprovedList(`${fakeParams.owNamespace}-`, false))
      test('when approvedList contains a namespace which shares the same suffix', async () => testApprovedList(`-${fakeParams.owNamespace}`, false))
      test('when approvedList contains a namespace which shares the same prefix and escape chars', async () => testApprovedList(`\\-${fakeParams.owNamespace}`, false))
      test('when approvedList contains a namespace which shares the same suffix and escape chars', async () => testApprovedList(`${fakeParams.owNamespace}\\-`, false))
      test('when approvedList contains a list of different namespaces with symbols (including stars!) and same suffix/prefix', async () => testApprovedList(`*,${fakeParams.owNamespace}*(#@),*,****()!_+$#|{">}, ${fakeParams.owNamespace}|, $${fakeParams.owNamespace}\\-`, false))

      test('when approvedList is equal to a star', async () => testApprovedList('*', true))
      test('when approvedList contains the input namespace(allowed)', async () => testApprovedList(`${fakeParams.owNamespace}`, true))
      test('when approvedList contains the input namespace in a list of namespaces with symbols (allowed)', async () => testApprovedList(`,${fakeParams.owNamespace},*(#@), ()!_+$#|{">}, anotherNS2|, \\dsafksad`, true))
    })

    describe('response format', () => {
      test('when there is no error, body equals generated credentials', async () => {
        const response = await tvm.processRequest(fakeParams)
        expect(response.statusCode).toEqual(200)
        expect(response.body).toEqual(mockResponse)
      })
    })
  })
})
