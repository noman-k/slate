'use client';
import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { hashAgentKey } from '@/lib/agent-keys';
import { newAuthorizationCode, redirectWith } from '@/lib/oauth';
import { AGENT_SCOPES, type AgentScope } from '@/lib/agent-scopes';
import { getSupabaseClient } from '@/lib/supabase/client';

export function ConsentForm(props: {
  clientId: string;
  appName: string;
  redirectUri: string;
  state?: string;
  challenge: string;
  workspaces: { id: string; name: string }[];
  defaultWorkspace: string;
  email: string;
}) {
  const [workspace, setWorkspace] = useState(props.defaultWorkspace);
  const [scope, setScope] = useState<AgentScope>('read');
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'cancelled'>('idle');
  const [error, setError] = useState('');

  const allow = async () => {
    if (!workspace || status !== 'idle') return;
    setStatus('busy');
    setError('');
    // The code is made here and only its hash is stored; the app gets the code itself.
    const code = newAuthorizationCode();
    const { error: failed } = await getSupabaseClient().rpc('oauth_authorize', {
      p_client_id: props.clientId,
      p_redirect_uri: props.redirectUri,
      p_workspace_id: workspace,
      p_scope: scope,
      p_code_challenge: props.challenge,
      p_code_hash: await hashAgentKey(code),
    });
    if (failed) {
      setStatus('idle');
      setError(/workspace/i.test(failed.message) ? 'That workspace hasn’t finished saving. Try again in a moment.' : 'Couldn’t connect the app just now. Try again.');
      return;
    }
    setStatus('done');
    window.location.assign(redirectWith(props.redirectUri, { code, state: props.state, iss: window.location.origin }));
  };
  const cancel = () => {
    setStatus('cancelled');
    window.location.assign(redirectWith(props.redirectUri, { error: 'access_denied', state: props.state }));
  };

  if (status === 'done' || status === 'cancelled')
    return (
      <p className="auth-message oauth-done" role="status">
        <Check size={15} aria-hidden />
        {status === 'done'
          ? `Connected. Taking you back to ${props.appName}… If nothing happens, you can close this tab.`
          : `Not connected. Taking you back to ${props.appName}… You can close this tab.`}
      </p>
    );

  const workspaceName = props.workspaces.find((w) => w.id === workspace)?.name || 'your workspace';
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void allow();
      }}
    >
      {props.workspaces.length > 1 ? (
        <label>
          Workspace
          <select value={workspace} onChange={(event) => setWorkspace(event.target.value)}>
            {props.workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name || 'Untitled workspace'}</option>
            ))}
          </select>
        </label>
      ) : (
        <div className="oauth-workspace">
          <span>Workspace</span>
          <strong>{workspaceName}</strong>
        </div>
      )}
      <fieldset className="agent-scope">
        <legend>What {props.appName} can do</legend>
        {AGENT_SCOPES.map((option) => (
          <label key={option.value} className={scope === option.value ? 'is-on' : undefined}>
            <input type="radio" name="scope" value={option.value} checked={scope === option.value} onChange={() => setScope(option.value)} />
            <span>
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="oauth-note">
        It can only reach <strong>{workspaceName}</strong>, never your other workspaces. Signed in as {props.email}.
      </p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="oauth-actions">
        <button type="button" className="oauth-cancel" onClick={cancel} disabled={status !== 'idle'}>Cancel</button>
        <button className="auth-submit" disabled={status !== 'idle' || !workspace}>
          {status === 'busy' && <LoaderCircle size={16} className="auth-spinner" />}
          Allow access
        </button>
      </div>
    </form>
  );
}
