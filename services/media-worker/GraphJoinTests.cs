using System.Net;
using System.Net.Http;
using System.Text;
using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class GraphJoinTests
{
    [Fact]
    public void ParsesThreadIdFromRedactedJoinUrl()
    {
        var url = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0";
        Assert.Equal("19:meeting_abc@thread.v2", GraphJoinClient.ThreadIdFromJoinUrl(url));
    }

    [Fact]
    public async Task CancelMediaProcessingPostsGraphPath()
    {
        var handler = new RecordingHandler();
        var http = new HttpClient(handler);
        var client = new GraphJoinClient("t", "id", "sec", "https://cb/callback", http);
        await client.CancelMediaProcessingAsync("call-1");
        Assert.Contains("/communications/calls/call-1/cancelMediaProcessing", handler.LastUri);
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public string LastUri { get; private set; } = "";

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastUri = request.RequestUri?.ToString() ?? "";
            if (LastUri.Contains("oauth2", StringComparison.OrdinalIgnoreCase))
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("""{"access_token":"tok","expires_in":3600}""", Encoding.UTF8, "application/json"),
                });
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json"),
            });
        }
    }
}
