# Debugging Challonge API 404 Error

## Quick Diagnosis Steps

### Step 1: Test the API Connection
Open your browser console and run:
```javascript
fetch('/api/test-challonge')
  .then(r => r.json())
  .then(data => {
    console.log('=== CHALLONGE API TEST RESULTS ===');
    console.table(data.tests);
    console.log('Full results:', data);
  })
  .catch(e => console.error('Test failed:', e));
```

### Step 2: Check the Results
Look for these test results:

**Test 1: GET /tournaments**
- ✅ **Status 200** = API Key works
- ❌ **Status 401/403** = API Key is invalid
- ❌ **Status 404** = Endpoint doesn't exist

**Test 2: POST /tournaments**
- ✅ **Status 201** = Can create tournaments
- ❌ Any error = Check the error details

**Test 3: v1 API test**
- Shows if the v1 API is accessible

## Common Issues & Solutions

### Issue: 404 on All Tests
**Cause**: Challonge API v2.1 might be deprecated or the endpoint is wrong
**Solution**: Check if the API base URL is correct:
- Current: `https://api.challonge.com/v2.1`
- Try: `https://api.challonge.com/v1` (older API)

### Issue: 401 Unauthorized
**Cause**: API key is invalid, expired, or incorrectly formatted
**Solution**:
1. Verify API key: `7eb30334967856353356f5bef299f68176c9432a0ddf45f3`
2. Go to https://challonge.com/settings/developer to check your API key
3. If different, update it in `api/challonge.ts`:
   ```typescript
   const API_KEY = 'YOUR_NEW_API_KEY';
   ```

### Issue: 403 Forbidden
**Cause**: API key exists but doesn't have permissions
**Solution**:
1. Check your Challonge account type (free vs pro)
2. Verify API key has correct permissions in settings
3. Try regenerating the API key

### Issue: Network/Connection Errors
**Cause**: Vercel can't reach Challonge API
**Solution**:
1. Check internet connection on deployment
2. Ensure Challonge API is accessible from your region
3. Try using a different API version

## Manual Testing

### Test via cURL (if you have access):
```bash
curl -X POST https://api.challonge.com/v2.1/tournaments \
  -H "Authorization: <YOUR_API_KEY>" \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "tournament": {
      "name": "Test Tournament",
      "url": "test-' + Date.now() + '",
      "tournament_type": "single_elimination"
    }
  }'
```

## Check Backend Logs

### On Vercel:
1. Go to your Vercel project
2. Open "Logs" → "Function Logs"
3. Create a bracket to trigger the request
4. Look for `[Challonge Proxy]` logs to see:
   - Full URL being called
   - API key being used
   - Response from Challonge
   - Any error details

### Locally:
1. Run `npm run dev` or similar
2. Create a bracket
3. Check console output for detailed logs

## Report Format

If the test doesn't work, please provide:
1. Screenshot of `/api/test-challonge` response
2. Error message from "Create Bracket"
3. Any logs from Vercel Function Logs
4. Confirm your Challonge account has API enabled

## Next Steps

After running the diagnostic:

- **If Test 1 passes**: Issue is with POST requests → Check request body format
- **If Test 2 passes**: Bracket creation should work → Check if data is being saved correctly
- **If all tests fail**: API key or endpoint is wrong → Update configuration

---

**Remember**: The API key is sensitive - don't share it publicly!
