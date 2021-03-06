import * as PubSub from '@google-cloud/pubsub';
import { google } from 'googleapis';
import { getEnv } from '../data/utils';
import { Accounts } from '../db/models';
import { IGmail as IMsgGmail } from '../db/models/definitions/conversationMessages';
import {
  getGmailUpdates,
  parseMessage,
  refreshAccessToken,
  syncConversation,
  updateHistoryByLastReceived,
} from './gmail';
import { getAccessToken, getAuthorizeUrl, getOauthClient } from './googleTracker';

export const trackGmailLogin = expressApp => {
  expressApp.get('/gmailLogin', async (req, res) => {
    // we don't have a code yet
    // so we'll redirect to the oauth dialog
    if (!req.query.code) {
      if (!req.query.error) {
        return res.redirect(getAuthorizeUrl());
      }

      return res.send('access denied');
    }

    const credentials: any = await getAccessToken(req.query.code);

    if (!credentials.refresh_token) {
      return res.send('You must remove Erxes from your gmail apps before reconnecting this account.');
    }

    // get email address connected with
    const { data } = await getGmailUserProfile(credentials);
    const email = data.emailAddress || '';

    await Accounts.createAccount({
      name: email,
      uid: email,
      kind: 'gmail',
      token: credentials.access_token,
      tokenSecret: credentials.refresh_token,
      expireDate: credentials.expiry_date,
      scope: credentials.scope,
    });

    const MAIN_APP_DOMAIN = getEnv({ name: 'MAIN_APP_DOMAIN' });

    return res.redirect(`${MAIN_APP_DOMAIN}/settings/integrations?gmailAuthorized=true`);
  });
};

/**
 * Get auth with valid credentials
 */
const getOAuth = (integrationId: string, credentials: any) => {
  const auth = getOauthClient();

  // Access tokens expire. This library will automatically use a refresh token to obtain a new access token
  auth.on('tokens', async tokens => {
    await refreshAccessToken(integrationId, tokens);
    credentials = tokens;
  });

  auth.setCredentials(credentials);
  return auth;
};
/**
 * Get permission granted email information
 */
export const getGmailUserProfile = (credentials: any) => {
  const auth = getOauthClient();

  auth.setCredentials(credentials);

  const gmail = google.gmail('v1');

  return gmail.users.getProfile({ auth, userId: 'me' }).catch(({ response }) => {
    throw new Error(response.data.error.message);
  });
};

/**
 * Send email
 */
const sendEmail = (integrationId: string, credentials: any, raw: string, threadId?: string) => {
  const auth = getOAuth(integrationId, credentials);
  const gmail = google.gmail('v1');

  const data = {
    auth,
    userId: 'me',
    resource: {
      raw,
      threadId,
    },
  };

  return gmail.users.messages.send(data).catch(({ response }) => {
    throw new Error(response.data.error.message);
  });
};

/**
 * Get attachment by attachmentId
 */
const getGmailAttachment = async (credentials: any, gmailData: IMsgGmail, attachmentId: string) => {
  if (!gmailData || !gmailData.attachments) {
    throw new Error('GmailData not found');
  }

  const attachment = await gmailData.attachments.find(a => a.attachmentId === attachmentId);

  if (!attachment) {
    throw new Error(`Gmail attachment not found id with ${attachmentId}`);
  }

  const { messageId } = gmailData;

  const gmail = await google.gmail('v1');
  const auth = getOauthClient();

  auth.setCredentials(credentials);

  return gmail.users.messages.attachments
    .get({
      auth,
      id: attachmentId,
      userId: 'me',
      messageId,
    })
    .catch(({ response }) => {
      throw new Error(response.data.error.message);
    })
    .then(({ data }) => {
      return {
        data: data.data,
        filename: attachment.filename,
      };
    });
};

/**
 * Get new messages by stored history id
 */
const getMessagesByHistoryId = async (historyId: string, integrationId: string, credentials: any) => {
  const auth = getOAuth(integrationId, credentials);
  const gmail = google.gmail('v1');

  const response = await gmail.users.history.list({
    auth,
    userId: 'me',
    startHistoryId: historyId,
  });

  if (!response.data.history) {
    return;
  }

  for (const history of response.data.history) {
    if (!history.messages) {
      continue;
    }

    await updateHistoryByLastReceived(integrationId, '' + history.id);

    for (const message of history.messages) {
      try {
        const { data } = await gmail.users.messages.get({
          auth,
          userId: 'me',
          id: message.id,
        });

        // get gmailData
        const gmailData = await parseMessage(data);
        if (gmailData) {
          await syncConversation(integrationId, gmailData);
        }
      } catch (e) {
        // catch & continue if email doesn't exist with message.id
        if (e.message === 'Not Found') {
          console.log(`Email not found id with ${message.id}`);
        } else {
          console.log(e.message);
        }
      }
    }
  }
};

/**
 * Listening email that connected with
 */
export const trackGmail = async () => {
  const GOOGLE_APPLICATION_CREDENTIALS = getEnv({ name: 'GOOGLE_APPLICATION_CREDENTIALS' });
  const GOOGLE_TOPIC = getEnv({ name: 'GOOGLE_TOPIC' });
  const GOOGLE_SUBSCRIPTION_NAME = getEnv({ name: 'GOOGLE_SUBSCRIPTION_NAME' });
  const GOOGLE_PROJECT_ID = getEnv({ name: 'GOOGLE_PROJECT_ID' });

  if (!GOOGLE_APPLICATION_CREDENTIALS || !GOOGLE_TOPIC || !GOOGLE_SUBSCRIPTION_NAME || !GOOGLE_PROJECT_ID) {
    return;
  }

  const pubsubClient = PubSub({
    projectId: GOOGLE_PROJECT_ID,
    keyFilename: GOOGLE_APPLICATION_CREDENTIALS,
  });

  const topic = pubsubClient.topic(GOOGLE_TOPIC);

  topic.createSubscription(GOOGLE_SUBSCRIPTION_NAME, (error, subscription) => {
    if (error) {
      throw error;
    }

    const errorHandler = (err: any) => {
      subscription.removeListener('message', messageHandler);
      subscription.removeListener('error', errorHandler);
      throw new Error(err);
    };

    const messageHandler = async (message: any) => {
      try {
        const data = JSON.parse(message.data.toString());
        await getGmailUpdates(data);
      } catch (error) {
        console.log(error.message);
      }

      // All notifications need to be acknowledged as per the Cloud Pub/Sub
      await message.ack();
    };

    subscription.on('error', errorHandler);
    subscription.on('message', messageHandler);
  });
};

export const callWatch = (credentials: any, integrationId: string) => {
  const gmail: any = google.gmail('v1');
  const GOOGLE_TOPIC = getEnv({ name: 'GOOGLE_TOPIC' });
  const auth = getOAuth(integrationId, credentials);

  return gmail.users
    .watch({
      auth,
      userId: 'me',
      labelIds: [
        'CATEGORY_UPDATES',
        'DRAFT',
        'CATEGORY_PROMOTIONS',
        'CATEGORY_SOCIAL',
        'CATEGORY_FORUMS',
        'TRASH',
        'CHAT',
        'SPAM',
      ],
      labelFilterAction: 'exclude',
      requestBody: {
        topicName: GOOGLE_TOPIC,
      },
    })
    .catch(({ response }) => {
      throw new Error(response.data.error.message);
    });
};

export const stopReceivingEmail = (email: string, credentials: any) => {
  const auth = getOauthClient();
  const gmail: any = google.gmail('v1');

  auth.setCredentials(credentials);

  gmail.users.stop({
    auth,
    userId: email,
  });
};

export const utils = {
  getMessagesByHistoryId,
  getGmailUserProfile,
  getGmailAttachment,
  sendEmail,
  stopReceivingEmail,
  callWatch,
};
