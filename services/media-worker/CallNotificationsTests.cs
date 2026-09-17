using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class CallNotificationsTests
{
    [Fact]
    public void ParsesEstablishedAndHangup()
    {
        var established = CallNotifications.Parse("""
            {"@odata.type":"#microsoft.graph.commsNotifications","value":[
              {"@odata.type":"#microsoft.graph.commsNotification","changeType":"updated",
               "resourceUrl":"/communications/calls/call-abc",
               "resourceData":{"@odata.type":"#microsoft.graph.call","state":"established"}}
            ]}
            """);
        Assert.Contains(established, n => n.Established && n.CallId == "call-abc");

        var hung = CallNotifications.Parse("""
            {"value":[{"changeType":"deleted","resourceUrl":"/app/calls/call-abc"}]}
            """);
        Assert.Contains(hung, n => n.Terminated && n.CallId == "call-abc");
    }

    [Fact]
    public void ParsesPlayPromptCompleted()
    {
        var n = CallNotifications.Parse("""
            {"value":[{"changeType":"updated","resourceUrl":"/communications/calls/c1",
              "resourceData":{"@odata.type":"#microsoft.graph.playPromptOperation","status":"completed"}}]}
            """);
        Assert.Contains(n, x => x.PlayCompleted && x.CallId == "c1");
        Assert.DoesNotContain(n, x => x.Terminated);
    }

    [Fact]
    public void PlayPromptOperationDeletedIsNotCallHangup()
    {
        var n = CallNotifications.Parse("""
            {"value":[{"changeType":"deleted","resourceUrl":"/communications/calls/c1/operations/op-9",
              "resourceData":{"@odata.type":"#microsoft.graph.playPromptOperation","status":"completed"}}]}
            """);
        Assert.Contains(n, x => x.CallId == "c1" && x.PlayCompleted);
        Assert.DoesNotContain(n, x => x.Terminated);
    }
}
