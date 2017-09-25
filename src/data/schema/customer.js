export const types = `
  input CustomerListParams {
    brand: String,
    integration: String,
    tag: String,
    limit: Int,
    page: String,
    segment: String,
    ids: [String]
  }

  type Customer {
    _id: String!
    integrationId: String
    name: String
    email: String
    phone: String
    isUser: Boolean
    createdAt: Date
    tagIds: [String]
    internalNotes: JSON
    messengerData: JSON
    twitterData: JSON
    facebookData: JSON

    conversations: [Conversation]
    getIntegrationData: JSON
    getMessengerCustomData: JSON
    getTags: [Tag]
  }

  type Segment {
    _id: String!
    name: String
    description: String
    subOf: String
    color: String
    connector: String
    conditions: JSON

    getParentSegment: Segment
    getSubSegments: [Segment]
  }
`;

export const queries = `
  customers(params: CustomerListParams): [Customer]
  customerCounts(params: CustomerListParams): JSON
  customerDetail(_id: String!): Customer
  customerListForSegmentPreview(segment: JSON, limit: Int): [Customer]
  totalCustomersCount: Int
  segments: [Segment]
  headSegments: [Segment]
  segmentDetail(_id: String): Segment
`;
